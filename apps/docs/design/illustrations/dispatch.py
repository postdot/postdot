"""Fixed orthographic scene. SVG delivery; no browser renderer or dependency."""
from pathlib import Path
from math import sqrt
ROOT = Path(__file__).resolve().parents[2] / 'public' / 'illustrations'
faces = []

def project(p):
    x,y,z=p
    return (440+(x-y)*sqrt(3)/2, 290+(x+y)/2-z)

def face(points, material, stroke=True):
    # Fixed nonintersecting assembly uses back-to-front object layers.
    # Large spanning planes are emitted before the objects they support.
    faces.append((points, material, stroke))

def box(x,y,z,w,d,h,material='paper'):
    a=(x,y,z); b=(x+w,y,z); c=(x+w,y+d,z); e=(x,y+d,z)
    A=(x,y,z+h); B=(x+w,y,z+h); C=(x+w,y+d,z+h); E=(x,y+d,z+h)
    face([e,c,C,E],material+'-front')
    face([b,c,C,B],material+'-side')
    face([A,B,C,E],material)

def line(points, material='line'):
    face(points, material, False)

# Low work surface, with two inset feet.
box(-140,-58,-64,20,145,30,'desk')
box(130,-58,-64,20,145,30,'desk')
box(-170,-85,-34,340,205,14,'desk')
# Rear rail is behind all objects and emitted before them.
box(-157,-77,-20,304,4,8,'desk')
# Three open document trays: bottoms and narrow back/side rails.
for z in [0,30,60]:
    box(-145,-60,z,116,92,5,'tray')
    box(-145,-60,z+5,116,4,17,'tray')
    box(-145,-56,z+5,4,84,17,'tray')
    box(-33,-56,z+5,4,84,17,'tray')
    for dz in [0,2,4]:
        box(-135,-49,z+6+dz,96,70,1.6)
# Exposed paper at top: short purposeful print marks, not fake interface text.
for yy,ww in [(-38,46),(-29,73),(-22,73),(-15,62),(0,35)]:
    line([(-126,yy,76),(-126+ww,yy,76)],'detail')
# Outgoing envelope lies in front of the trays.
box(-18,42,-18,135,69,3,'paper')
line([(-18,42,-14),(49.5,84,-14),(117,42,-14)],'line')
line([(-18,111,-14),(22,72,-14)],'detail')
line([(117,111,-14),(77,72,-14)],'detail')
box(91,51,-13,15,17,.8,'blue')
# Compact stamping press on the right, built with clear physical support.
box(33,-60,-20,102,71,8,'blue')
box(110,-52,-12,14,54,98,'metal')
box(47,-52,78,77,54,10,'metal')
box(70,-34,36,29,20,42,'blue')
box(56,-43,28,58,39,8,'metal')
box(48,-42,-10,58,38,2)
# A crisp blue imprint and a few real document rules below the press.
box(60,-31,-7,17,13,.5,'blue')
for yy in [-9,-3]:
    line([(61,yy,-6),(94,yy,-6)],'detail')


palettes={
 'light':dict(bg='#f4f4f4',line='#353535',detail='#9a9a9a',paper='#ffffff',desk='#e9e9e9',tray='#f4f4f4',metal='#dddddd',blue='#2457d6'),
 'dark':dict(bg='#171717',line='#d4d4d4',detail='#737373',paper='#282828',desk='#202020',tray='#242424',metal='#303030',blue='#94b5ff')}
for theme,p in palettes.items():
    parts=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="100 85 660 420" role="img" aria-labelledby="title desc"><title id="title">Preparation and dispatch desk</title><desc id="desc">Three open paper trays, a stamping press and an outgoing envelope, drawn in a fixed isometric view.</desc>']
    for points,mat,filled in faces:
        coords=' '.join(f'{a:.2f},{b:.2f}' for a,b in map(project,points))
        if not filled:
            parts.append(f'<polyline points="{coords}" fill="none" stroke="{p[mat]}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>');continue
        base=mat.replace('-front','').replace('-side','')
        fill=p[base]
        # Plane tones are restrained; geometry carries the scene.
        parts.append(f'<polygon points="{coords}" fill="{fill}" stroke="{p["line"]}" stroke-width="1.1" stroke-linejoin="round"/>')
        if mat.endswith('-front') or mat.endswith('-side'):
            tint='#000' if theme=='light' else '#fff';opacity='.055' if mat.endswith('-front') else '.10'
            parts.append(f'<polygon points="{coords}" fill="{tint}" opacity="{opacity}"/>')
    parts.append('</svg>')
    (ROOT/f'dispatch-{theme}.svg').write_text(''.join(parts))
