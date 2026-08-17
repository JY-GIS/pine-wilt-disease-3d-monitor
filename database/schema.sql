-- 真实数据库结构逆向恢复脚本（public schema）
-- 来源：songcai，PostgreSQL 14.23 / PostGIS 3.6.1。
-- 本文件仅还原当前结构，不包含行政区划和业务数据。
-- 建议在 psql 中执行：psql -d songcai -f database/schema.sql
-- SQL 速读：CREATE 创建对象；ALTER 修改已创建对象；DEFAULT 指定插入时未赋值的默认值；
-- NOT NULL 表示字段必填；::regclass 是 PostgreSQL 将对象名转换为对象引用的写法。

-- 扩展相当于为数据库安装功能包。IF NOT EXISTS 表示已安装时不报错。
-- PostGIS 必须先于 geometry(...) 字段创建；earthdistance 依赖 cube。
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_sfcgal;
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- 序列为整数 ID 的发号器。AS integer、起始值、步长、缓存均与真实库一致。
-- public.users_id_seq 中 public 是 schema 名；点号表示“schema.对象名”。
CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.diseased_trees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.admin_region_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE public.city_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

-- CREATE TABLE 的括号内是列定义；每行依次为“字段名 类型 约束/默认值”。
-- nextval(...) 表示插入时未提供 id，就从相应序列取下一个整数。
CREATE TABLE public.users (
    id integer NOT NULL DEFAULT nextval('public.users_id_seq'::regclass),
    user_id character varying(10) NOT NULL,
    username character varying(50) NOT NULL,
    phone character varying(11) NOT NULL,
    password character varying(20)
);

-- geometry(Point,4326)：Point 为点几何，4326 为 WGS 84 经纬度坐标系。
-- 此处严格保留 geom 可为空的真实状态。
CREATE TABLE public.diseased_trees (
    id integer NOT NULL DEFAULT nextval('public.diseased_trees_id_seq'::regclass),
    tree_id character varying(50) NOT NULL,
    survey_id character varying(10) NOT NULL,
    species character varying(50) NOT NULL,
    grade integer NOT NULL,
    chest integer NOT NULL,
    longitude double precision NOT NULL,
    latitude double precision NOT NULL,
    survey_date date NOT NULL,
    geom geometry(Point,4326)
);

-- geometry(MultiPolygon,4326)：多面几何，例如省级行政区边界。
CREATE TABLE public.admin_region (
    id integer NOT NULL DEFAULT nextval('public.admin_region_id_seq'::regclass),
    name character varying(50) NOT NULL,
    gb_code character varying(20),
    level character varying(10) DEFAULT 'province'::character varying,
    geom geometry(MultiPolygon,4326),
    area_km2 double precision
);

CREATE TABLE public.city (
    id integer NOT NULL DEFAULT nextval('public.city_id_seq'::regclass),
    geom geometry(MultiPolygon,4326),
    name character varying(50),
    gb_code character varying(20)
);

-- OWNED BY 建立序列与 id 字段的从属关系；删除字段/表时序列会被一并处理。
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
ALTER SEQUENCE public.diseased_trees_id_seq OWNED BY public.diseased_trees.id;
ALTER SEQUENCE public.admin_region_id_seq OWNED BY public.admin_region.id;
ALTER SEQUENCE public.city_id_seq OWNED BY public.city.id;

-- ADD CONSTRAINT 添加约束。PRIMARY KEY 同时要求非空和唯一；UNIQUE 只要求值不重复。
-- PostgreSQL 会自动为主键和唯一约束建立对应的 B-Tree 索引。
-- ONLY 表示仅作用于当前表，不作用于可能存在的继承子表。
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_user_id_key UNIQUE (user_id);

ALTER TABLE ONLY public.diseased_trees
    ADD CONSTRAINT diseased_trees_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.diseased_trees
    ADD CONSTRAINT diseased_trees_tree_id_key UNIQUE (tree_id);

ALTER TABLE ONLY public.admin_region
    ADD CONSTRAINT admin_region_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.admin_region
    ADD CONSTRAINT admin_region_gb_code_key UNIQUE (gb_code);

ALTER TABLE ONLY public.city
    ADD CONSTRAINT city_pkey PRIMARY KEY (id);

-- setval(序列名, 数值, 是否已调用) 设置序列状态。
-- true：下次 nextval 返回“数值 + 1”；false：下次 nextval 返回“数值”。
-- 真实库中的 users 序列尚未被 nextval 调用，故保留 false。
SELECT pg_catalog.setval('public.users_id_seq', 1, false);
SELECT pg_catalog.setval('public.diseased_trees_id_seq', 556, true);
SELECT pg_catalog.setval('public.admin_region_id_seq', 34, true);
SELECT pg_catalog.setval('public.city_id_seq', 745, true);
