-- 真实数据库的非约束索引。
-- 主键和唯一约束对应的 B-Tree 索引已由 schema.sql 的约束自动创建：
-- users_pkey, users_user_id_key, diseased_trees_pkey,
-- diseased_trees_tree_id_key, admin_region_pkey,
-- admin_region_gb_code_key, city_pkey。
-- 不在此重复创建，以保证 schema.sql -> index.sql 可以直接顺序执行。
-- SQL 速读：CREATE INDEX 创建普通索引；USING btree/gist 指定索引方法；
-- (列名) 是索引键，((表达式)) 是表达式索引。索引不保存新业务数据，只加速查询。

-- B-Tree：真实库中按 gb_code 建立的普通索引。
CREATE INDEX idx_admin_region_code
    ON public.admin_region USING btree (gb_code);

-- GiST：PostGIS 的空间索引方法。下列 geom 索引用于包围盒过滤与空间关系查询。
CREATE INDEX idx_admin_region_geom
    ON public.admin_region USING gist (geom);

CREATE INDEX sidx_city_geom
    ON public.city USING gist (geom);

CREATE INDEX diseased_trees_geom_idx
    ON public.diseased_trees USING gist (geom);

CREATE INDEX idx_diseased_trees_geom
    ON public.diseased_trees USING gist (geom);

-- 表达式 GiST 索引：查询中出现 geom::geography 时可使用它。
-- :: 是 PostgreSQL 类型转换运算符；这里没有把 geom 字段改成 geography。
CREATE INDEX idx_diseased_trees_geom_geog
    ON public.diseased_trees USING gist ((geom::geography));
