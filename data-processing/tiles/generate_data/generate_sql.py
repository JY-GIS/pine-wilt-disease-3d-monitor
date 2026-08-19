import random

sql_list = []

# 山东范围（测试）
min_lon = 117.0
max_lon = 118.5
min_lat = 35.0
max_lat = 37.0
# 三种模型
models = {
    1: "pine-green.glb",
    2: "pine-green.glb",
    3: "pine-yellow.glb",
    4: "pine-yellow.glb",
    5: "pine-dry.glb"
}

for i in range(10000):
    # 随机位置
    lon = random.uniform(min_lon,max_lon)
    lat = random.uniform(min_lat,max_lat)
    # 随机病害等级
    level = random.randint(1,5)
    # 根据等级选择模型
    model = models[level]

    sql = f"""
INSERT INTO tree_instances
(
geom,
disease_level,
scale,
model
)
VALUES
(
ST_SetSRID(
ST_MakePoint(
{lon},
{lat}
),
4326
),
{level},
15,
'{model}'
);
"""

    sql_list.append(sql)


# 写入sql文件

with open(
    "tree_instances.sql",
    "w",
    encoding="utf-8"
) as f:

    f.write(
        "\n".join(sql_list)
    )


print("10000条树实例SQL生成完成")