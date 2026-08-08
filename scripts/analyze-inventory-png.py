# -*- coding: utf-8 -*-
"""找出 inventory.png 中所有槽位中心坐标。

槽位内部填充为 ~128 灰（RGB 128,128,128）。用 4 邻域连通域聚类这些像素，
每个连通域的质心即槽中心。输出按 (行, 列) 排序的坐标清单。
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'public', 'assets', 'gui', 'inventory.png')

def is_slot_interior(r, g, b, a):
    return a > 200 and abs(r - 128) <= 24 and abs(g - 128) <= 24 and abs(b - 128) <= 24

def main():
    img = Image.open(PATH).convert('RGBA')
    w, h = img.size
    px = img.load()

    visited = [[False] * w for _ in range(h)]
    centers = []
    for y0 in range(h):
        for x0 in range(w):
            if visited[y0][x0] or not is_slot_interior(*px[x0, y0][:4]):
                continue
            # BFS 连通域
            stack = [(x0, y0)]
            visited[y0][x0] = True
            xs, ys = [], []
            while stack:
                x, y = stack.pop()
                xs.append(x)
                ys.append(y)
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx] and is_slot_interior(*px[nx, ny][:4]):
                        visited[ny][nx] = True
                        stack.append((nx, ny))
            if len(xs) >= 40:  # 槽内部约 14x14=196 像素，40 为噪声阈值
                cx = sum(xs) / len(xs)
                cy = sum(ys) / len(ys)
                centers.append((round(cx, 1), round(cy, 1)))

    centers.sort(key=lambda c: (round(c[1] / 18), c[0]))
    for cx, cy in centers:
        print(f'槽中心: ({cx}, {cy})')
    print(f'共 {len(centers)} 个槽位')

if __name__ == '__main__':
    main()
