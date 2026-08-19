import random
import json

# 山东一个范围
min_lon = 117.0
max_lon = 118.5
min_lat = 35.0
max_lat = 37.0

trees = []

for i in range(10000):
    tree = {
        "id": i,
        "longitude":
            random.uniform(min_lon,max_lon),
        "latitude":
            random.uniform(min_lat,max_lat),
        "height":0,
        "scale":15,
    }
    trees.append(tree)

with open("instances-before.json", "w", encoding="utf-8") as f:
    json.dump(
        trees,
        f,
        indent=2
    )
print("生成完成")