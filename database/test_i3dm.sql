CREATE TABLE tree_instances
(
    id SERIAL PRIMARY KEY,
    geom geometry(Point,4326),
    disease_level integer,
    scale double precision,
    model text
);
drop table tree_instances;

select count(*) from tree_instances;

select * from tree_instances limit 5;

select model , count(*) from tree_instances group by model;

CREATE VIEW green_tree_instances AS
SELECT * FROM tree_instances WHERE disease_level=1 or disease_level=2;
CREATE VIEW yellow_tree_instances AS
SELECT * FROM tree_instances WHERE disease_level=3 or disease_level=4;
CREATE VIEW dry_tree_instances AS
SELECT * FROM tree_instances WHERE disease_level=5;

-- 创建视图
CREATE OR REPLACE VIEW tree_instances_3dtiles AS
SELECT
    id,
    ST_SetSRID(
            ST_MakePoint(
                    ST_X(geom),
                    ST_Y(geom),
                    0 -- 高度暂时设置为零
            ),
            4326
    ) AS geom,

    COALESCE(NULLIF(scale, 0), 1.0)::double precision AS scale,

    0.0::double precision AS yaw,
    0.0::double precision AS pitch,
    0.0::double precision AS roll,

    CASE model
        WHEN 'pine-green.glb'
            THEN 'D:/pine-wilt-disease-3d-monitor/data-processing/tiles/model/pine-green.glb'
        WHEN 'pine-yellow.glb'
            THEN 'D:/pine-wilt-disease-3d-monitor/data-processing/tiles/model/pine-yellow.glb'
        WHEN 'pine-dry.glb'
            THEN 'D:/pine-wilt-disease-3d-monitor/data-processing/tiles/model/pine-dry.glb'
        ELSE NULL
        END AS model,

    json_build_array(
            json_build_object('id', id),
            json_build_object('disease_level', disease_level)
    ) AS tags

FROM tree_instances
WHERE geom IS NOT NULL
  AND model IS NOT NULL;


CREATE OR REPLACE VIEW public.tree_instances_3dtiles_low AS
SELECT
    id,
    geom,
    scale,
    yaw,
    pitch,
    roll,

    CASE
        WHEN model ILIKE '%pine-green.glb'
            THEN 'D:/pine-wilt-disease-3d-monitor/data-processing/tiles/tree-models-lod/low/pine-green-low.glb'

        WHEN model ILIKE '%pine-yellow.glb'
            THEN 'D:/pine-wilt-disease-3d-monitor/data-processing/tiles/tree-models-lod/low/pine-yellow-low.glb'

        WHEN model ILIKE '%pine-dry.glb'
            THEN 'D:/pine-wilt-disease-3d-monitor/data-processing/tiles/tree-models-lod/low/pine-dry-low.glb'

        ELSE NULL
        END AS model,

    tags

FROM public.tree_instances_3dtiles

WHERE model ILIKE '%pine-green.glb'
   OR model ILIKE '%pine-yellow.glb'
   OR model ILIKE '%pine-dry.glb';
