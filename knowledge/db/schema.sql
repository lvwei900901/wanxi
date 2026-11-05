-- =====================================================================
-- AsterVision 品牌产品知识中心 · SQLite 物理模型
-- 版本：v1（pragma user_version = 1）
-- 方言：SQLite 3.45+
-- 约定：主键自增整数；时间列用 datetime 亲和性（Prisma 以 epoch 毫秒读写，
--       手写 SQL 侧以 ISO-8601 文本读写，两种落值都合法）；JSON 列存文本
-- =====================================================================

pragma foreign_keys = ON;
pragma user_version = 1;

-- ---------------------------------------------------------------------
-- brand：品牌根节点（1 行，但保留多品牌能力，所有内容表都带 brand_id）
-- ---------------------------------------------------------------------
create table brand (
  id                integer  primary key autoincrement,
  slug              text     not null unique,
  name              text     not null,
  description       text,
  website           text,
  founded_year      integer,
  headquarters      text,
  core_capabilities text     not null default '[]',   -- JSON string[]，纯展示，不做筛选维度
  logo_url          text,
  og_image_url      text,
  meta_title        text,
  meta_description  text,
  canonical_url     text,
  created_at        datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- ---------------------------------------------------------------------
-- product_series：产品线，列表页 Series 筛选项的唯一来源
-- ---------------------------------------------------------------------
create table product_series (
  id               integer  primary key autoincrement,
  brand_id         integer  not null references brand(id) on delete cascade,
  slug             text     not null,
  name             text     not null,
  description      text,
  sort_order       integer  not null default 0,
  status           text     not null default 'active'
                     check (status in ('active','archived')),
  hero_image_url   text,
  og_image_url     text,
  meta_title       text,
  meta_description text,
  canonical_url    text,
  created_at       datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  unique (brand_id, slug)
);

create index idx_series_brand_order on product_series(brand_id, sort_order);

-- ---------------------------------------------------------------------
-- product：产品主表，slug 全局唯一，即 /products/[slug] 的路由参数
--   resolution / connectivity / environment 用真列（可筛选可排序）
--   extra_specs 承接 CMS 后续新增的任意规格
-- ---------------------------------------------------------------------
create table product (
  id                integer  primary key autoincrement,
  brand_id          integer  not null references brand(id) on delete cascade,
  series_id         integer  not null references product_series(id) on delete restrict,
  legacy_id         integer  unique,                    -- 源 JSON 的 id，保证种子可重复执行
  slug              text     not null unique,
  name              text     not null,
  short_description text,
  overview          text,
  resolution        text,
  connectivity      text,
  environment       text,
  extra_specs       text,                              -- JSON，可空
  status            text     not null default 'active'
                      check (status in ('active','beta','discontinued')),
  sort_order        integer  not null default 0,
  image_url         text,
  og_image_url      text,
  meta_title        text,
  meta_description  text,
  canonical_url     text,
  published_at      datetime,
  created_at        datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at        datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create index idx_product_series_order on product(series_id, sort_order);
create index idx_product_brand        on product(brand_id);
create index idx_product_status       on product(status);

-- ---------------------------------------------------------------------
-- feature：特性词表。key_features 与 specs.ai_features 合并于此，用 kind 区分
--   kind = 'key' → 详情页 Features 区块（营销表述）
--   kind = 'ai'  → 规格表 AI 能力行（技术表述）
-- ---------------------------------------------------------------------
create table feature (
  id         integer primary key autoincrement,
  slug       text    not null unique,
  name       text    not null,
  kind       text    not null default 'key' check (kind in ('key','ai')),
  category   text,
  sort_order integer not null default 0
);

create index idx_feature_kind on feature(kind, sort_order);

-- product ↔ feature 多对多，sort_order 保留源数据的展示顺序
create table product_feature (
  product_id integer not null references product(id) on delete cascade,
  feature_id integer not null references feature(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, feature_id)
);

create index idx_pf_feature on product_feature(feature_id);

-- ---------------------------------------------------------------------
-- scenario：场景词表，替代源数据的 best_for 字符串数组
--   is_canonical = 1 → 来自 scenarios.json 的官方场景
--   is_canonical = 0 → 由产品 best_for 反推补建（Lobby / Critical Infrastructure …）
-- ---------------------------------------------------------------------
create table scenario (
  id               integer  primary key autoincrement,
  slug             text     not null unique,
  name             text     not null,
  description      text,
  is_canonical     integer  not null default 1 check (is_canonical in (0,1)),
  sort_order       integer  not null default 0,
  meta_title       text,
  meta_description text,
  canonical_url    text,
  created_at       datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at       datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create index idx_scenario_order on scenario(is_canonical, sort_order);

create table product_scenario (
  product_id  integer not null references product(id) on delete cascade,
  scenario_id integer not null references scenario(id) on delete cascade,
  sort_order  integer not null default 0,
  primary key (product_id, scenario_id)
);

create index idx_ps_scenario on product_scenario(scenario_id);

-- ---------------------------------------------------------------------
-- faq：四级归属。brand_id 必填，product / series / scenario 可选
--   品牌级 FAQ 用于首页 Organization + FAQPage 结构化数据，不被产品锁死
-- ---------------------------------------------------------------------
create table faq (
  id             integer  primary key autoincrement,
  legacy_id      integer  unique,
  brand_id       integer  not null references brand(id) on delete cascade,
  product_id     integer  references product(id)        on delete cascade,
  series_id      integer  references product_series(id) on delete set null,
  scenario_id    integer  references scenario(id)       on delete set null,
  scope          text     not null default 'product'
                   check (scope in ('brand','series','product','scenario')),
  question       text     not null,
  answer         text     not null,
  answer_summary text,                                 -- ≤160 字符，AEO / AI 直答片段
  sort_order     integer  not null default 0,
  is_featured    integer  not null default 0 check (is_featured in (0,1)),
  status         text     not null default 'published'
                   check (status in ('published','draft')),
  created_at     datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at     datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  -- scope 与归属列必须自洽，避免出现"说是产品级却没有 product_id"
  check (scope <> 'product' or product_id is not null),
  check (scope <> 'series'  or series_id  is not null),
  check (scope <> 'scenario' or scenario_id is not null),
  check (scope <> 'brand'   or (product_id is null and series_id is null and scenario_id is null))
);

create index idx_faq_product   on faq(product_id, sort_order);
create index idx_faq_brand     on faq(brand_id, scope);

-- ---------------------------------------------------------------------
-- knowledge_chunk：AskAI 知识分块（GLM embedding-3 / 2048 维）
--   多态引用不建物理外键：重建索引时整表清空重写，不做级联
--   embedding 为 Float32 小端 BLOB：2048 × 4 = 8192 字节/条
-- ---------------------------------------------------------------------
create table knowledge_chunk (
  id           integer  primary key autoincrement,
  external_id  text     not null,                      -- 稳定键，形如 product:1:0（跨版本相同）
  source_type  text     not null
                 check (source_type in ('brand','series','product','faq','scenario')),
  source_id    integer,
  chunk_index  integer  not null default 0,
  heading      text,
  content      text     not null,
  url_path     text,                                  -- 命中后回链的页面路径
  embedding    blob     not null,
  model        text     not null,
  dimensions   integer  not null,
  content_hash text     not null,                      -- sha256(content)，内容未变则跳过重算
  index_version integer not null,                     -- → embedding_index.id
  template_version integer not null,                  -- 分块模板版本，模板一改强制全量重算
  built_at     datetime not null,

  -- 唯一性必须带版本号：同一个逻辑块会同时存在于 active 与上一版中（用于回滚）
  unique (index_version, source_type, source_id, chunk_index)
);

create index idx_chunk_source  on knowledge_chunk(source_type, source_id);
create index idx_chunk_model   on knowledge_chunk(model);
create index idx_chunk_version on knowledge_chunk(index_version);

-- ---------------------------------------------------------------------
-- embedding_index：索引版本表（蓝绿部署）
--   building → 正在构建，不可检索；active → 当前生效；superseded → 上一版，保留可回滚
--   检索永远只读 status='active' 的那一版，构建失败时旧版本原样可用
-- ---------------------------------------------------------------------
create table embedding_index (
  id             integer  primary key autoincrement,
  model          text     not null,
  dimensions     integer  not null,
  chunk_size     integer  not null,
  document_count integer  not null,
  chunk_count    integer  not null,
  template_version integer  not null default 1,
  status         text     not null default 'active'
                   check (status in ('building','active','superseded')),
  built_at       datetime not null,
  activated_at   datetime,
  source_file    text     not null,
  source_hash    text     not null,
  created_at     datetime not null default (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

create index idx_index_status on embedding_index(status, id);
