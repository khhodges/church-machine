"""Generate the small Thread badge animation (Python 3.11 + Pillow).

Illustration only: movement is not execution/progress telemetry.
"""
from pathlib import Path
import math
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / 'artifacts/development-image/src/assets'
SCALE = 3
SIZE = 120
BG = '#172636'
INK = '#e9a27b'


def frame(index):
    t = (index % 20) / 20
    image = Image.new('RGB', (SIZE*SCALE, SIZE*SCALE), BG)
    draw = ImageDraw.Draw(image)

    def line(points, fill=INK, width=2.7):
        points = [(round(x*SCALE), round(y*SCALE)) for x, y in points]
        draw.line(points, fill=fill, width=round(width*SCALE), joint='curve')
        r = width*SCALE/2
        for x, y in points:
            draw.ellipse((x-r, y-r, x+r, y+r), fill=fill)

    # Stair treads scroll down/left by exactly one step per stride.
    points = []
    for step in range(-4, 7):
        x, y = 44+16*step-16*t, 84-12*step+12*t
        points.extend([(x,y),(x+16,y),(x+16,y-12)])
    line(points, '#8c6b59', 2)
    bob = -1.8*math.sin(math.pi*t)
    hip, shoulder = (54, 62+bob), (59, 40+bob)
    # One planted foot follows its tread; the other lifts to the next tread.
    planted = (52-16*t,84+12*t)
    swing = (36+16*t,96-12*t-15*math.sin(math.pi*t))

    def leg(foot):
        dx, dy = foot[0]-hip[0], foot[1]-hip[1]
        distance = math.hypot(dx,dy)
        height = math.sqrt(max(0, 21**2-(distance/2)**2))
        knee = ((hip[0]+foot[0])/2+dy/distance*height,
                (hip[1]+foot[1])/2-dx/distance*height)
        line([hip,knee,foot])
        line([foot,(foot[0]+5,foot[1])])
    leg(planted)
    leg(swing)
    line([hip,shoulder])
    arm = math.cos(2*math.pi*t)
    line([shoulder,(48-4*arm,49+bob),(43-3*arm,43+bob)], '#bd8669', 2.5)
    line([shoulder,(68+3*arm,49+bob),(75+3*arm,42+bob)])
    cx,cy,r = 62,29+bob,7
    draw.ellipse(tuple(v*SCALE for v in (cx-r,cy-r,cx+r,cy+r)), outline=INK, width=round(2.7*SCALE))
    mask = Image.new('L',image.size,0)
    ImageDraw.Draw(mask).ellipse((18*SCALE,18*SCALE,102*SCALE,102*SCALE),fill=255)
    clipped = Image.new('RGB',image.size,'#121e2c')
    clipped.paste(image,(0,0),mask)
    ImageDraw.Draw(clipped).ellipse((17*SCALE,17*SCALE,103*SCALE,103*SCALE),outline=INK,width=3*SCALE)
    return clipped.resize((240,240),Image.Resampling.LANCZOS)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    frames = [frame(i) for i in range(20)]
    frames[0].save(OUT/'thread-climber-still.png',optimize=True)
    frames[0].save(OUT/'thread-climber.gif',save_all=True,append_images=frames[1:],
                   duration=65,loop=0,disposal=2,optimize=True)
    print('Generated Thread badge: 20 frames, 1.3-second endless loop')


if __name__ == '__main__':
    main()
