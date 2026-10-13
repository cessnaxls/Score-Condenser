import sys,io,zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from engine import analyze,score_xml,make_mxl,make_pdf,render_upload
from PIL import Image,ImageDraw
from xml.etree import ElementTree as ET

def test_exports():
    events=[{'label':'breve','pitch':'C4','beat':0,'staff':0,'measure':1,'page':0,'id':'n1'}, {'label':'long','pitch':'G4','beat':8,'staff':0,'measure':1,'page':0,'id':'n2'}]
    xml=score_xml(events,'test')
    root=ET.fromstring(xml)
    assert [n.text for n in root.findall('.//type')]==['breve','long']
    mxl=make_mxl(xml)
    with zipfile.ZipFile(io.BytesIO(mxl)) as z:
        assert z.read('mimetype')==b'application/vnd.recordare.musicxml'
        assert ET.fromstring(z.read('score.musicxml')).find('.//movement-title').text=='test'
    pdf=make_pdf(events,'test')
    assert pdf.startswith(b'%PDF')
    print('PASS: note value MusicXML, valid MXL and PDF output')

def test_image():
    im=Image.new('RGB',(800,240),'white');d=ImageDraw.Draw(im)
    for y in (45,60,75,90,105):d.line((30,y,760,y),fill='black',width=2)
    a=analyze(im);assert a['width']==800;assert len(a['staves'])>=1
    f=io.BytesIO();im.save(f,format='PNG');assert len(render_upload(f.getvalue(),'test.png'))==1
    print('PASS: image input, detected staff coordinates')
if __name__=='__main__':test_exports();test_image()
