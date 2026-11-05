#!/usr/bin/env python3
"""Regenerates the app icons in public/ (pure Python, no dependencies): python3 scripts/generate-icons.py
Placeholder design: a green speech bubble on dark navy. Replace the PNGs with real artwork any time."""
import struct, zlib

BG = (15, 23, 42)
FG = (0, 220, 130)

def in_rrect(x, y, cx, cy, hw, hh, r):
    dx, dy = abs(x - cx) - (hw - r), abs(y - cy) - (hh - r)
    if dx <= 0 or dy <= 0:
        return abs(x - cx) <= hw and abs(y - cy) <= hh
    return dx * dx + dy * dy <= r * r

def in_tri(px, py, a, b, c):
    def s(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    d1, d2, d3 = s((px, py), a, b), s((px, py), b, c), s((px, py), c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

def bubble(x, y, k):
    # k scales the bubble around the centre (maskable icons need a bigger safe margin)
    u, v = 0.5 + (x - 0.5) / k, 0.5 + (y - 0.5) / k
    return in_rrect(u, v, 0.5, 0.45, 0.27, 0.19, 0.08) or in_tri(u, v, (0.33, 0.60), (0.50, 0.60), (0.31, 0.77))

def render(size, k, rounded):
    ss = 3
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            r = g = b = a = 0
            for sj in range(ss):
                for si in range(ss):
                    x, y = (i + (si + .5) / ss) / size, (j + (sj + .5) / ss) / size
                    inside = in_rrect(x, y, .5, .5, .5, .5, .22) if rounded else True
                    if not inside:
                        continue
                    c = FG if bubble(x, y, k) else BG
                    r += c[0]; g += c[1]; b += c[2]; a += 255
            n = ss * ss
            if a:
                cnt = a // 255
                row += bytes((r // cnt, g // cnt, b // cnt, a // n))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    return rows

def png(path, size, k, rounded):
    raw = b''.join(render(size, k, rounded))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)
    print('wrote', path)

png('public/icon-192.png', 192, 1.0, True)
png('public/icon-512.png', 512, 1.0, True)
png('public/icon-maskable-512.png', 512, 0.8, False)  # full bleed, content inside the safe zone
png('public/apple-touch-icon.png', 180, 0.9, False)   # iOS rounds the corners itself
