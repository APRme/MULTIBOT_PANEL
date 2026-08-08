# -*- coding: utf-8 -*-
"""从 Minecraft 版本 jar 提取物品图标到 public/assets/items/。

策略：
- textures/item/*.png 全部提取（工具/材料/食物等）
- textures/block/*.png 也提取（方块类物品的图标来自方块贴图，如 oak_planks、torch）
- 同名冲突时 item 优先
- 生成 public/assets/items-index.json（可用文件名清单），前端据此决定是否请求图标

素材与索引均在 public/assets/ 下，已被 .gitignore 忽略（Mojang 资产，本地自用）。
"""
import json
import os
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_JAR = os.path.join(ROOT, 'scripts', '26.1.2.jar')
OUT_DIR = os.path.join(ROOT, 'public', 'assets', 'items')
INDEX_PATH = os.path.join(ROOT, 'public', 'assets', 'items-index.json')


def extract(jar_path):
    z = zipfile.ZipFile(jar_path)
    names = z.namelist()

    # 先收集 block（方块物品回退源），再收集 item（优先覆盖）
    collected = {}
    for prefix in ('assets/minecraft/textures/block/', 'assets/minecraft/textures/item/'):
        for name in names:
            if not (name.startswith(prefix) and name.endswith('.png')):
                continue
            file_name = os.path.basename(name)
            collected[file_name] = z.read(name)  # item 后写，覆盖同名 block

    os.makedirs(OUT_DIR, exist_ok=True)
    for file_name, data in collected.items():
        with open(os.path.join(OUT_DIR, file_name), 'wb') as f:
            f.write(data)

    index = sorted(collected.keys())
    with open(INDEX_PATH, 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)

    total = sum(len(v) for v in collected.values())
    print(f'已提取 {len(collected)} 个图标 -> {OUT_DIR}（{total / 1024:.0f} KB）')
    print(f'索引 -> {INDEX_PATH}')


if __name__ == '__main__':
    jar = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JAR
    if not os.path.exists(jar):
        raise SystemExit(f'找不到 jar: {jar}')
    extract(jar)
