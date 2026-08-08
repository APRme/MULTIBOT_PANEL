# -*- coding: utf-8 -*-
"""从 generic_54.png（双箱子 176x222）按标准 GUI 布局裁切拼接出单箱子背景 chest.png（176x167）。

布局依据（wiki.vg Inventory / Minecraft GUI 纹理标准，1.8+ 未变）：
  双箱子: 标题+容器两排 y0..124(0..70/71..124) | 间隔 125..136 | 背包 137..190 | 间隔 191..198 | 快捷栏 199..216 | 底 217..221
  单箱子: 标题+容器一排 y0..70 | 间隔 71..82 | 背包 83..136 | 间隔 137..144 | 快捷栏 145..162 | 底 163..166
两处间隔与背包/快捷栏/底部条带内容一致，仅相对容器位置不同，故按条带重排。
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public', 'assets', 'gui', 'generic_54.png')
OUT = os.path.join(ROOT, 'public', 'assets', 'gui', 'chest.png')

# (源 y0, 源 y1) 条带 → (目标 y0) 位置
STRIPS = [
    ((0, 71), 0),      # 标题 + 容器第一排
    ((125, 137), 71),  # 容器/背包间隔
    ((137, 191), 83),  # 背包 9x3
    ((191, 199), 137), # 背包/快捷栏间隔
    ((199, 217), 145), # 快捷栏 9
    ((217, 221), 163), # 底部
]

def main():
    img = Image.open(SRC).convert('RGBA')
    if img.size != (256, 256):
        raise SystemExit(f'意外尺寸 {img.size}，期望 256x256')

    canvas = Image.new('RGBA', (176, 167), (0, 0, 0, 0))
    for (sy0, sy1), dy0 in STRIPS:
        strip = img.crop((0, sy0, 176, sy1))
        canvas.paste(strip, (0, dy0))

    canvas.save(OUT)
    alpha = canvas.getchannel('A')
    print(f'chest.png 已生成: {canvas.size}, bbox={alpha.getbbox()}')
    # 抽样验证：各区域中心列（x=88）在槽行应为不透明
    for label, y in [('标题区', 8), ('容器槽行1', 26), ('容器槽行3', 62), ('背包槽行1', 92), ('快捷栏槽行', 154)]:
        print(f'  {label} y={y}: alpha={alpha.getpixel((88, y))}')

if __name__ == '__main__':
    main()
