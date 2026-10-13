#!/usr/bin/env python3
"""Audiveris-free, reproducible OMR geometry/symbol evidence generator.

Input: PNG/JPEG/WebP filename. Output: JSON for independent AI/manual review.
Does NOT invent pitch/duration/MusicXML where clefs/symbols are uncertain.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np


def runs(bits):
    edges = np.diff(np.r_[False, bits, False].astype(np.int8))
    return list(zip(np.where(edges == 1)[0].tolist(), np.where(edges == -1)[0].tolist()))


def median_line(ink, x0, x1, threshold=.46):
    hits = np.mean(ink[:, x0:x1], axis=1)
    found = []
    for a, b in runs(hits >= threshold):
        if b - a <= 7:
            found.append((a+b-1)/2)
    return found


def find_staves(gray):
    h,w = gray.shape
    ink = gray < 155
    # Support printing extending across the left or right but ignore large margins.
    strips = [(int(w*.06),int(w*.94)),(int(w*.17),int(w*.82)),(int(w*.30),int(w*.70))]
    ys = max((median_line(ink,a,b,th) for a,b in strips for th in (.44,.34,.25)),key=len,default=[])
    candidates=[]
    for i in range(len(ys)-4):
        five = ys[i:i+5]
        d = np.diff(five); spacing=float(np.median(d))
        if 3.2 <= spacing <= 70 and np.max(np.abs(d-spacing)) <= max(2.,spacing*.20):
            score=float(1/(1+np.std(d)))
            candidates.append((score,i,[round(float(z),2) for z in five],round(spacing,2)))
    candidates.sort(reverse=True)
    chosen=[];occupied=[]
    for score,i,lines,spacing in candidates:
        if any(abs(lines[0]-y)<spacing*4.5 for y in occupied):continue
        chosen.append({'lines':lines,'spacing':spacing,'top':lines[0],'bottom':lines[-1], 'detectionConfidence':round(score,3)})
        occupied.append(lines[0])
    chosen.sort(key=lambda s:s['top'])
    return chosen


def symbols_for_staff(gray,staff):
    h,w=gray.shape
    sp=staff['spacing']; top,bottom=staff['top'],staff['bottom']
    margin=int(sp*2.9)
    y0=max(0,int(top-margin)); y1=min(h,int(bottom+margin))
    roi=gray[y0:y1]
    # Remove only narrow horizontal line structures; retain notehead evidence.
    dark=(roi<160).astype(np.uint8)*255
    horizontal=cv2.morphologyEx(dark,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(max(20,int(sp*3.3)),1)))
    clean=cv2.subtract(dark,horizontal)
    count, labels, stats, centroids=cv2.connectedComponentsWithStats(clean,8)
    components=[]
    for i in range(1,count):
        x,y,ww,hh,area=map(int,stats[i]); cx,cy=centroids[i]
        if area<max(3,int(sp*.17)) or ww>w*.22 or hh>sp*9:continue
        if ww<sp*.22 and hh<sp*.22:continue
        components.append({'x':x,'y':y+y0,'w':ww,'h':hh,'area':area,'cx':round(float(cx),1),'cy':round(float(cy+y0),1)})
    # Noteheads often touch stems: find ellipsoidal dark/high-ink areas via local morphology.
    # Template-free elliptical kernels adapt to staff spacing.
    kx=max(3,int(round(sp*1.03)));ky=max(3,int(round(sp*.67)))
    kernel=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(kx|1,ky|1))
    headMask=cv2.morphologyEx(clean,cv2.MORPH_OPEN,kernel)
    headContours,_=cv2.findContours(headMask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    heads=[]
    for cnt in headContours:
        x,y,ww,hh=cv2.boundingRect(cnt)
        if ww<sp*.45 or ww>sp*2.4 or hh<sp*.35 or hh>sp*1.7:continue
        cx=x+ww/2;cy=y+hh/2+y0
        relative=(staff['bottom']-cy)/(sp/2) # 0=bottom line, 1=space immediately above
        nearest=round(relative)
        if abs(relative-nearest)>.43:continue
        heads.append({'x':round(cx,1),'y':round(cy,1),'staffStep':nearest,
                      'staffStepOffset':round(relative-nearest,2),
                      'bbox':[x,y+y0,ww,hh], 'kind':'filled-notehead-candidate',
                      'confidence':round(max(.2,1-abs(relative-nearest)),2)})
    # Detect thin vertical strokes that could be barlines; distinguish staff-spanning from note stems.
    vertical=cv2.morphologyEx(dark,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_RECT,(1,max(4,int(sp*3.1)))))
    cols=(vertical>0).sum(axis=0)
    barXs=[]
    for a,b in runs(cols>=sp*3.6):
        x=(a+b-1)/2
        if b-a<=max(5,sp*.75):
            barXs.append(round(x,1))
    barXs=[x for x in barXs if x > w*.03 and x < w*.97]
    # Avoid issuing measure claims from uncertain lines.
    barXs=[x for i,x in enumerate(barXs) if i==0 or x-barXs[i-1]>sp*.8]
    return {'noteheadCandidates':heads[:2000],'barlineCandidates':barXs[:300],
            'componentCount':len(components),
            'symbolCandidates':components[:350],
            'warnings':['Candidate symbols are geometrical observations, not verified musical events. Hollow notes, rests, clefs, ties and historical symbols require interpretation.']}


def recognize(filename):
    raw=np.fromfile(str(filename),dtype=np.uint8)
    original=cv2.imdecode(raw,cv2.IMREAD_GRAYSCALE)
    if original is None: raise ValueError('Cannot decode the image')
    h,w=original.shape
    if w*h>100_000_000:raise ValueError('Image exceeds 100 million pixels')
    # CLAHE works on older prints without inferring any notes.
    enhanced=cv2.createCLAHE(clipLimit=2,tileGridSize=(8,8)).apply(original)
    # No automatic deskew without explicit traceable transform; skew is reported.
    staves=find_staves(enhanced)
    for n,s in enumerate(staves,1):
        s['staffIndex']=n;s.update(symbols_for_staff(enhanced,s))
    return {'schemaVersion':'1.0','engine':'cv2-symbol-evidence','width':w,'height':h,
            'staffCount':len(staves),'staves':staves,
            'warnings':(['No reliable five-line staves found: review manually.'] if not staves else [])+
             ['Geometry is NOT a music transcription. GPT or human review must resolve clefs, pitches, note types, timing, accidentals and voice ownership.'],
            'accuracyCertified':False}


def main():
    p=argparse.ArgumentParser();p.add_argument('image');p.add_argument('--output');args=p.parse_args()
    evidence=recognize(Path(args.image));payload=json.dumps(evidence,separators=(',',':'))
    if args.output:Path(args.output).write_text(payload)
    else:print(payload)

if __name__=='__main__':main()
