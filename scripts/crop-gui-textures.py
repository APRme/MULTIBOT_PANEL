# -*- coding: utf-8 -*-
"""把 256x256 的 Minecraft GUI 纹理图集裁剪到实际绘制区域（去除透明边距）。

面板的背包背景渲染要求背景图与槽位布局表使用同一坐标系：
槽位用 像素/绘制区域宽高 的百分比定位，背景图必须与绘制区域 1:1，
否则 256x256 图集被 background-size:100% 拉伸后，绘制区只占容器约 69% 宽，槽位全部错位。
"""
import os

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'public', 'assets', 'gui')

def main():
    for name in sorted(os.listdir(DIR)):
        if not name.endswith('.png'):
            continue
        path = os.path.join(DIR, name)
        img = Image.open(path).convert('RGBA')
        bbox = img.getchannel('A').getbbox()
        if bbox is None:
            print(f'{name}: 全透明，跳过')
            continue
        if bbox != (0, 0, img.size[0], img.size[1]):
            img.crop(bbox).save(path)
            print(f'{name}: {img.size} -> {bbox[2]}x{bbox[3]}')
        else:
            print(f'{name}: 无需裁剪 ({img.size[0]}x{img.size[1]})')

if __name__ == '__main__':
    main()
