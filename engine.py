"""Conservative evidence-first staff/symbol proposals and notation exports."""
import io, math, zipfile, html, re
from collections import defaultdict
import numpy as np
import cv2
import fitz
from PIL import Image
from xml.etree import ElementTree as ET
from reportlab.pdfgen.canvas import Canvas
from reportlab.lib.pagesizes import A4

LABELS={'quarter','eighth','16th','32nd','half','whole','breve','long','rest-quarter','rest-half','rest-whole','rest-eighth','sharp','flat','natural','clef-g','clef-f','clef-c','barline','dot','tie','other'}
NOTE_DUR={'quarter':1,'eighth':0.5,'16th':0.25,'32nd':0.125,'half':2,'whole':4,'breve':8,'long':16}
REST_DUR={'rest-quarter':1,'rest-half':2,'rest-whole':4,'rest-eighth':0.5}

def render_upload(data, name):
    ext=name.lower().rsplit('.',1)[-1]
    if ext=='pdf':
        document=fitz.open(stream=data,filetype='pdf')
        if len(document)>30: raise ValueError('Maximum 30 PDF pages per upload')
        images=[]
        for page in document:
            pix=page.get_pixmap(matrix=fitz.Matrix(1.6,1.6),alpha=False)
            images.append(Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGB'))
        return images
    if ext not in ('png','jpg','jpeg','webp','tif','tiff'): raise ValueError('Unsupported file type')
    image=Image.open(io.BytesIO(data)).convert('RGB')
    if image.width*image.height>35_000_000: raise ValueError('Image resolution too large')
    return [image]

def analyze(image):
    gray=np.array(image.convert('L'))
    h,w=gray.shape
    bw=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)[1]
    # Horizontal line concentration identifies possible staves. Do not claim 100% detection.
    horizontal=cv2.morphologyEx(bw,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(15,w//35),1)))
    hits=np.count_nonzero(horizontal,axis=1)
    ys=np.flatnonzero(hits>max(35,w*0.19))
    lines=[]
    for y in ys:
        if not lines or y>lines[-1][-1]+1: lines.append([int(y)])
        else: lines[-1].append(int(y))
    mid=[int(np.median(cluster)) for cluster in lines]
    staves=[]; i=0
    while i+4<len(mid):
        group=mid[i:i+5]
        diffs=np.diff(group)
        if min(diffs)>=5 and max(diffs)<=44 and max(diffs)-min(diffs)<=max(3,np.median(diffs)*0.34):
            staves.append({'lines':group,'spacing':float(np.median(diffs))})
            i+=5
        else:i+=1
    # Connected components after staff-line suppression: candidates, NOT definitive symbols.
    without=cv2.subtract(bw,horizontal)
    n,lab,stats,centroids=cv2.connectedComponentsWithStats(without)
    candidates=[]
    for j in range(1,n):
        x,y,ww,hh,area=map(int,stats[j]);cx,cy=centroids[j]
        if area<7 or ww<2 or hh<2 or ww>min(145,w*0.25) or hh>min(150,h*0.20):continue
        staff_idx=-1
        if staves:
            ds=[max(0,abs(cy-(s['lines'][0]+s['lines'][-1])/2)-s['spacing']*2) for s in staves]
            staff_idx=int(np.argmin(ds))
            if ds[staff_idx]>staves[staff_idx]['spacing']*5:staff_idx=-1
        # Slight expansion so user sees shape, including staff in crop.
        candidates.append({'id':f'c{j}','box':[max(0,x-4),max(0,y-4),min(w-x+4,ww+8),min(h-y+4,hh+8)],'staff':staff_idx,'status':'unreviewed'})
    # Avoid hundreds of fragments from letters and page furniture; expose manual boxes.
    candidates=sorted(candidates,key=lambda a:(a['staff'],a['box'][1],a['box'][0]))[:900]
    return {'width':w,'height':h,'staves':staves,'candidates':candidates,'warning':'Detections are candidates, not a complete or correct musical transcription. Add missing symbols manually.'}

def verify(events):
    if not isinstance(events,list) or len(events)>10000:raise ValueError('Invalid symbol event list')
    out=[]
    for index,e in enumerate(events):
        if e.get('decision')=='ignore': continue
        label=e.get('label')
        if label not in LABELS:raise ValueError(f'Symbol {index+1} needs a valid label')
        if label=='other':raise ValueError(f'Symbol {index+1} remains unresolved')
        page=int(e.get('page',0));staff=int(e.get('staff',0));measure=int(e.get('measure',1))
        if page<0 or staff<0 or measure<1 or measure>9999: raise ValueError(f'Invalid location for symbol {index+1}')
        if label in NOTE_DUR:
            pitch=str(e.get('pitch','')).strip().upper()
            if not re.fullmatch(r'[A-G](?:#|B)?[0-8]',pitch):raise ValueError(f'Pitch missing/invalid for note {index+1}')
        else:pitch=None
        beat=float(e.get('beat',0))
        if not math.isfinite(beat) or beat<0 or beat>256:raise ValueError(f'Invalid beat for symbol {index+1}')
        out.append(dict(e,page=page,staff=staff,measure=measure,beat=beat,label=label,pitch=pitch))
    return out

def score_xml(events, title='Transcribed score'):
    accepted=verify(events)
    parts=sorted(set((e['page'],e['staff']) for e in accepted if e['label'] in NOTE_DUR or e['label'] in REST_DUR))
    if not parts:raise ValueError('No labeled notes or rests to export')
    root=ET.Element('score-partwise',version='4.0')
    ET.SubElement(root,'work');ET.SubElement(root,'movement-title').text=title
    plist=ET.SubElement(root,'part-list')
    # staff identity is preserved by order on each page; future pages map to same staff index
    staves=sorted(set(s for _,s in parts))
    for staff in staves:
        sp=ET.SubElement(plist,'score-part',id=f'P{staff+1}');ET.SubElement(sp,'part-name').text=f'Staff {staff+1}'
    for staff in staves:
        p=ET.SubElement(root,'part',id=f'P{staff+1}')
        measures=sorted(set((e['page'],e['measure']) for e in accepted if e['staff']==staff and e['label'] in NOTE_DUR|REST_DUR))
        for count,(page,mnum) in enumerate(measures,1):
            m=ET.SubElement(p,'measure',number=str(count))
            att=ET.SubElement(m,'attributes');ET.SubElement(att,'divisions').text='10080'
            # These values must be manually verified in visual review; default treble only for visualization.
            c=ET.SubElement(att,'clef');ET.SubElement(c,'sign').text='G';ET.SubElement(c,'line').text='2'
            sequence=sorted((e for e in accepted if e['staff']==staff and e['page']==page and e['measure']==mnum and e['label'] in NOTE_DUR|REST_DUR),key=lambda e:(e['beat'],e.get('id','')))
            cursor=0.0
            for e in sequence:
                if e['beat']>cursor+1e-6:
                    f=ET.SubElement(m,'forward');ET.SubElement(f,'duration').text=str(round((e['beat']-cursor)*10080));cursor=e['beat']
                elif e['beat']<cursor-1e-6:
                    b=ET.SubElement(m,'backup');ET.SubElement(b,'duration').text=str(round((cursor-e['beat'])*10080));cursor=e['beat']
                note=ET.SubElement(m,'note')
                if e['label'] in REST_DUR:
                    ET.SubElement(note,'rest');duration=REST_DUR[e['label']];kind=e['label'][5:]
                else:
                    pitch=e['pitch'];pn=ET.SubElement(note,'pitch');ET.SubElement(pn,'step').text=pitch[0]
                    if len(pitch)==3:ET.SubElement(pn,'alter').text='1' if pitch[1]=='#' else '-1'
                    ET.SubElement(pn,'octave').text=pitch[-1];duration=NOTE_DUR[e['label']];kind=e['label']
                ET.SubElement(note,'duration').text=str(int(duration*10080));ET.SubElement(note,'type').text=kind
                if e.get('id'):ET.SubElement(note,'notations').append(ET.Element('other-notation',type='single',text=str(e['id'])))
                cursor=e['beat']+duration
    return ET.tostring(root,encoding='utf-8',xml_declaration=True)

def make_mxl(xml):
    f=io.BytesIO()
    with zipfile.ZipFile(f,'w') as z:
        z.writestr('mimetype','application/vnd.recordare.musicxml',compress_type=zipfile.ZIP_STORED)
        z.writestr('META-INF/container.xml','<?xml version="1.0"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>')
        z.writestr('score.musicxml',xml)
    return f.getvalue()

def make_pdf(events,title='Transcribed score'):
    """Simple treble-clef staff engraving of *user-confirmed* events; not a full music engraver."""
    accepted=verify(events)
    data=defaultdict(list)
    for e in accepted:
        if e['label'] in NOTE_DUR or e['label'] in REST_DUR:
            data[(e['page'],e['staff'],e['measure'])].append(e)
    if not data:raise ValueError('No notes or rests')
    f=io.BytesIO();c=Canvas(f,pagesize=A4);W,H=A4;c.setTitle(title)
    y=H-85
    c.setFont('Helvetica-Bold',16);c.drawString(40,H-44,title[:75])
    scaleSteps={'C':0,'D':1,'E':2,'F':3,'G':4,'A':5,'B':6}
    def step_of(pitch):
        # E4 at bottom line (treble), every diatonic step is half a staff-space.
        return ((int(pitch[-1])-4)*7+scaleSteps[pitch[0]])-2
    for (page,staff,measure),items in sorted(data.items()):
        if y<115:
            c.showPage();y=H-85
        c.setFont('Helvetica',9)
        c.drawString(41,y+19,f'Page {page+1} · Staff {staff+1} · Measure {measure}')
        left=65;right=W-50;gap=9
        for line in range(5):c.line(left,y+line*gap,right,y+line*gap)
        c.setFont('Helvetica-Bold',22);c.drawString(left+5,y+3,'G')  # clef indicator (not authoritative)
        items=sorted(items,key=lambda e:(e['beat'],e.get('id','')))
        maxbeat=max([e['beat']+(NOTE_DUR.get(e['label']) or REST_DUR.get(e['label']) or 1) for e in items]+[4])
        for e in items:
            x=left+42+min(1,e['beat']/maxbeat)*(right-left-65)
            if e['label'] in REST_DUR:
                c.setFont('Helvetica',9);c.drawCentredString(x,y+19,'REST');continue
            step=step_of(e['pitch']);ny=y+step*gap/2
            # Ledger lines every second diatonic step beyond five staff lines.
            if step<0:
                for ledger in range(-2,step-1,-2):c.line(x-9,y+ledger*gap/2,x+9,y+ledger*gap/2)
            if step>8:
                for ledger in range(10,step+1,2):c.line(x-9,y+ledger*gap/2,x+9,y+ledger*gap/2)
            typ=e['label'];c.saveState()
            if len(e['pitch'])==3:
                c.setFont('Helvetica',12);c.drawRightString(x-11,ny-4,'#' if e['pitch'][1]=='#' else 'b')
            if typ in ('breve','long'):
                c.rect(x-7,ny-5,14,10,fill=0,stroke=1)
                if typ=='long':c.line(x+7,ny+5,x+7,ny-20)
            else:
                c.translate(x,ny);c.rotate(-17)
                path=c.beginPath();path.ellipse(-7,-4,7,4)
                c.drawPath(path,fill=int(typ not in ('whole','half')),stroke=1)
                c.rotate(17)
                if typ!='whole':
                    c.line(7,0,7,29)
                    if typ in ('eighth','16th','32nd'):
                        c.line(7,29,16,20)
            c.restoreState()
        y-=95
    c.setFont('Helvetica-Oblique',8)
    c.drawString(38,24,'Provisional treble-clef visualization. Verify clefs, timing, rests and accidentals against the source.')
    c.save();return f.getvalue()
