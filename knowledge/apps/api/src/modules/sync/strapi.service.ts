/**
 * Strapi → 本地库的 ingest。
 *
 * webhook 只负责说「内容变了」，不负责把内容搬过来。少了这一层，
 * `index/reindex` 重建出来的永远是库里的旧内容——webhook 200、版本号 +1、
 * 站点没变，是最难排查的那种「成功」。
 *
 * 三个必须处理的现实：
 *  1. Strapi v4 的 REST 响应是 `{ id, attributes: {...} }`，v5 是扁平的；
 *     关联字段还会包一层 `{ data: ... }`。flatten() 统一压平，否则换个版本就全空。
 *  2. 草稿不能同步。`publishedAt` 为 null 的条目直接跳过，否则未发布内容会漏到线上。
 *  3. 远端很可能只有一部分内容（先建了 3 个产品就开始接 webhook）。整字段覆盖
 *     会把本地更完整的记录打残：overview 变 null、手写的场景关联被删空。
 *     所以默认走 merge——只写远端真正给出非空值的字段。
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { StrapiSyncMode, StrapiSyncReportDto, StrapiSyncTableDto } from '@kb/contracts';
import { PrismaService } from '../../prisma/prisma.service';

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** v4 的 attributes 包装与关联的 data 包装，压成一层 */
export function flatten(node: unknown): Raw | null {
  if (!isObject(node)) return null;
  if ('attributes' in node && isObject(node.attributes)) {
    return { id: node.id, documentId: node.documentId, ...flatten(node.attributes) };
  }
  // 关联可能是 {data: {...}}（单值）或 {data: [...]}（多值）。
  // 单值继续往里压；多值原样保留，交给 unwrapList 处理——
  // 在这里压平会把整个数组变成一个 null，关联直接静默丢失。
  if ('data' in node && node.data !== undefined) {
    if (Array.isArray(node.data)) return node;
    return flatten(node.data);
  }
  return node;
}

/** 把 {data:[...]} / {data:{...}} / 数组 / 单值统一成数组 */
export function unwrapList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value;
  if (isObject(value) && 'data' in value) return unwrapList(value.data);
  return [value];
}

export function flattenList(node: unknown): Raw[] {
  if (node === null || node === undefined) return [];
  if (Array.isArray(node)) return node.map(flatten).filter((v): v is Raw => v !== null);
  const one = flatten(node);
  return one ? [one] : [];
}

const str = (v: unknown): string | null => {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
};

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);

function pick<T>(obj: Raw, keys: string[], read: (v: unknown) => T | null): T | null {
  for (const key of keys) {
    const value = read(obj[key]);
    if (value !== null) return value;
  }
  return null;
}

const nameToSlug = (value: unknown): string | null => {
  const text = str(value);
  return text ? slugify(text) : null;
};

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

/** 关联字段可能是对象数组、字符串数组，或 {data:[...]} 包装 */
function refSlugs(value: unknown): string[] {
  return unwrapList(value)
    .map((item) => {
      if (typeof item === 'string') return item.trim() || null;
      const obj = flatten(item);
      if (!obj) return null;
      return str(obj.slug) ?? nameToSlug(obj.name);
    })
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function refSlug(value: unknown): string | null {
  const obj = flatten(value);
  if (obj) return str(obj.slug) ?? nameToSlug(obj.name);
  return str(value);
}

const emptyCounters = (collection: string): StrapiSyncTableDto => ({
  collection,
  fetched: 0,
  created: 0,
  updated: 0,
  skipped: 0,
});

/**
 * 字段补丁构造器，把两种写入模式的差别收在这一处。
 *
 * merge：值为空 → 整个键不出现，Prisma 保持库里的原值。
 *        这是默认档，用来防「远端只有半条数据，把本地完整记录覆盖成残缺」。
 * mirror：值为空 → 明确写 null（有兜底值就用兜底值），Strapi 是唯一权威。
 */
class Patch {
  private readonly data: Record<string, unknown> = {};

  constructor(private readonly strict: boolean) {}

  set(key: string, value: unknown, fallback?: unknown): this {
    if (value !== null && value !== undefined) {
      this.data[key] = value;
      return this;
    }
    if (!this.strict) return this;
    this.data[key] = fallback !== undefined ? fallback : null;
    return this;
  }

  /** 结构必填字段（外键等），两种模式都要写 */
  force(key: string, value: unknown): this {
    this.data[key] = value;
    return this;
  }

  build(): Record<string, unknown> {
    return this.data;
  }
}

export type SyncOptions = {
  dryRun?: boolean;
  /** 默认 merge：只写远端给出非空值的字段 */
  mode?: StrapiSyncMode;
  /** 默认 false：远端没有的本地条目只报告不删除 */
  prune?: boolean;
};

@Injectable()
export class StrapiSyncService {
  private readonly logger = new Logger(StrapiSyncService.name);
  /** collection → 上次命中过的 REST 路径段（单数还是复数），避免每次都试错 */
  private readonly routeCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async sync({ dryRun = false, mode = 'merge', prune = false }: SyncOptions = {}): Promise<StrapiSyncReportDto> {
    const started = Date.now();
    const strict = mode === 'mirror';
    const rawUrl = process.env.STRAPI_URL?.trim();
    if (!rawUrl) {
      throw new HttpException(
        '未配置 STRAPI_URL，无法从 Strapi 同步内容（见 apps/api/.env）',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const baseUrl = rawUrl.replace(/\/+$/, '');
    const token = process.env.STRAPI_TOKEN?.trim() ?? '';

    const [brandRows, seriesRows, scenarioRows, productRows, faqRows] = await Promise.all([
      this.fetchAll(baseUrl, token, 'brand'),
      this.fetchAll(baseUrl, token, 'product-series'),
      this.fetchAll(baseUrl, token, 'scenario'),
      this.fetchAll(baseUrl, token, 'product'),
      this.fetchAll(baseUrl, token, 'faq'),
    ]);

    const tables: StrapiSyncTableDto[] = [];
    const warnings: string[] = [];

    const apply = async (tx: Prisma.TransactionClient) => {
      const db = tx;

      // ---- 品牌：单条 ----
      const brandTable = emptyCounters('brand');
      brandTable.fetched = brandRows.length;
      const brandRaw = brandRows[0] ? flatten(brandRows[0]) : null;
      let brandId = 0;
      if (!brandRaw) {
        brandTable.skipped = brandRows.length || 1;
        warnings.push('Strapi 里没有 brand 记录：系列与产品无法挂载，已全部跳过');
      } else {
        const slug = str(brandRaw.slug) ?? slugify(str(brandRaw.name) ?? 'brand');
        const existing = await db.brand.findUnique({ where: { slug }, select: { id: true } });
        const capabilities = list(brandRaw.coreCapabilities ?? brandRaw.core_capabilities)
          .map((v) => str(v))
          .filter((v): v is string => v !== null);
        const data = new Patch(strict)
          .set('name', str(brandRaw.name) ?? slug)
          .set('description', str(brandRaw.description))
          .set('website', str(brandRaw.website))
          .set('foundedYear', num(brandRaw.foundedYear ?? brandRaw.founded_year ?? brandRaw.founded))
          .set('headquarters', str(brandRaw.headquarters))
          // 空数组在 merge 下不写：远端没配能力清单，不该把本地手写的清空
          .set('coreCapabilities', capabilities.length > 0 ? JSON.stringify(capabilities) : null, '[]')
          .build();
        if (existing) brandTable.updated += 1;
        else brandTable.created += 1;
        if (!dryRun) {
          const row = existing
            ? await db.brand.update({ where: { id: existing.id }, data })
            : await db.brand.create({ data: { slug, ...data } as unknown as Prisma.BrandUncheckedCreateInput });
          brandId = row.id;
        } else {
          brandId = existing?.id ?? 0;
        }
      }
      tables.push(brandTable);

      // ---- 系列 ----
      const seriesTable = emptyCounters('product-series');
      seriesTable.fetched = seriesRows.length;
      const seriesIdBySlug = new Map<string, number>();
      for (const [i, raw] of seriesRows.entries()) {
        const row = flatten(raw);
        if (!row) {
          seriesTable.skipped += 1;
          continue;
        }
        if (row.publishedAt === null) {
          seriesTable.skipped += 1;
          warnings.push(`系列 ${str(row.slug) ?? i} 是草稿（publishedAt=null），已跳过`);
          continue;
        }
        const slug = str(row.slug) ?? slugify(str(row.name) ?? '');
        if (!slug) {
          seriesTable.skipped += 1;
          continue;
        }
        // dryRun 也要按实跑的口径计数，否则预演报告显示「将创建 5 条」、实跑全 skipped
        if (!brandId) {
          seriesTable.skipped += 1;
          continue;
        }
        const data = new Patch(strict)
          .force('name', str(row.name) ?? slug)
          .set('description', str(row.description))
          .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
          .set(
            'status',
            // Strapi 5 里 `status` 是 Draft & Publish 的保留查询参数，不能再当属性名，
            // 所以内容侧改叫 lifecycleStatus。这里同时认旧名，便于过渡期两头都能读。
            str(row.lifecycleStatus ?? row.lifecycle_status ?? row.status) === 'discontinued'
              ? 'discontinued'
              : str(row.lifecycleStatus ?? row.lifecycle_status ?? row.status) === 'active'
                ? 'active'
                : null,
            'active',
          )
          .set('metaTitle', str(row.metaTitle ?? row.meta_title))
          .set('metaDescription', str(row.metaDescription ?? row.meta_description))
          .build();
        const existing = await db.productSeries.findUnique({
          where: { brandId_slug: { brandId, slug } },
          select: { id: true },
        });
        if (existing) seriesTable.updated += 1;
        else seriesTable.created += 1;
        if (!dryRun) {
          const saved = existing
            ? await db.productSeries.update({ where: { id: existing.id }, data })
            : await db.productSeries.create({
                data: { brandId, slug, ...data } as unknown as Prisma.ProductSeriesUncheckedCreateInput,
              });
          seriesIdBySlug.set(slug, saved.id);
        } else if (existing) {
          seriesIdBySlug.set(slug, existing.id);
        }
      }
      tables.push(seriesTable);

      // ---- 场景 ----
      const scenarioTable = emptyCounters('scenario');
      scenarioTable.fetched = scenarioRows.length;
      const scenarioIdBySlug = new Map<string, number>();
      for (const [i, raw] of scenarioRows.entries()) {
        const row = flatten(raw);
        const slug = row ? str(row.slug) ?? slugify(str(row.name) ?? '') : '';
        if (!row || !slug) {
          scenarioTable.skipped += 1;
          continue;
        }
        const data = new Patch(strict)
          .force('name', str(row.name) ?? slug)
          .set('description', str(row.description))
          // isCanonical 缺省即 true 是老数据的约定；merge 下不写，避免把补建场景翻成官方场景
          .set('isCanonical', row.isCanonical === undefined ? null : Boolean(row.isCanonical), true)
          .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
          .build();
        const existing = await db.scenario.findUnique({ where: { slug }, select: { id: true } });
        if (existing) scenarioTable.updated += 1;
        else scenarioTable.created += 1;
        if (!dryRun) {
          const saved = existing
            ? await db.scenario.update({ where: { id: existing.id }, data })
            : await db.scenario.create({ data: { slug, ...data } as unknown as Prisma.ScenarioUncheckedCreateInput });
          scenarioIdBySlug.set(slug, saved.id);
        } else if (existing) {
          scenarioIdBySlug.set(slug, existing.id);
        }
      }
      // 兜底：本地可能还有 Strapi 里没有的场景（早期从产品 best_for 派生补建的）。
      // 只认本次拉取的 8 条，产品上指向这些场景的关联会被静默丢掉。
      const localScenarios = await db.scenario.findMany({ select: { id: true, slug: true } });
      for (const local of localScenarios) {
        if (!scenarioIdBySlug.has(local.slug)) scenarioIdBySlug.set(local.slug, local.id);
      }

      tables.push(scenarioTable);

      // ---- 产品 ----
      const productTable = emptyCounters('product');
      productTable.fetched = productRows.length;
      for (const [i, raw] of productRows.entries()) {
        const row = flatten(raw);
        if (!row) {
          productTable.skipped += 1;
          continue;
        }
        if (row.publishedAt === null) {
          productTable.skipped += 1;
          warnings.push(`产品 ${str(row.slug) ?? i} 是草稿（publishedAt=null），已跳过`);
          continue;
        }
        const slug = str(row.slug) ?? slugify(str(row.name) ?? '');
        const seriesSlug = refSlug(row.series ?? row.productSeries ?? row.product_series);
        if (!slug || !seriesSlug) {
          productTable.skipped += 1;
          warnings.push(`产品 ${slug || i} 缺少 slug 或 series 关联，已跳过`);
          continue;
        }
        const seriesId = seriesIdBySlug.get(seriesSlug);
        if (!seriesId) {
          productTable.skipped += 1;
          warnings.push(`产品 ${slug} 指向不存在的系列 ${seriesSlug}，已跳过`);
          continue;
        }

        const specs = isObject(row.specs) ? row.specs : {};
        // Strapi 5 不再允许自定义 `status` 属性（与 Draft & Publish 的查询参数撞名），
        // 内容侧统一叫 lifecycleStatus；旧名一并兼容，避免过渡期读空后退化成 active。
        const statusRaw = str(row.lifecycleStatus ?? row.lifecycle_status ?? row.status);
        const data = new Patch(strict)
          .force('seriesId', seriesId)
          .force('name', str(row.name) ?? slug)
          .set('shortDescription', str(row.shortDescription ?? row.short_description))
          .set('overview', str(row.overview))
          .set('resolution', pick(row, ['resolution'], str) ?? pick(specs, ['resolution'], str))
          .set('connectivity', pick(row, ['connectivity'], str) ?? pick(specs, ['connectivity'], str))
          .set('environment', pick(row, ['environment'], str) ?? pick(specs, ['environment'], str))
          // specs 为空对象时不写：merge 下 `"{}"` 会把本地补充的规格整块抹掉
          .set('extraSpecs', Object.keys(specs).length > 0 ? JSON.stringify(specs) : null, '{}')
          .set('status', statusRaw === 'discontinued' || statusRaw === 'beta' || statusRaw === 'active' ? statusRaw : null, 'active')
          .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
          .set('metaTitle', str(row.metaTitle ?? row.meta_title))
          .set('metaDescription', str(row.metaDescription ?? row.meta_description))
          // 远端没给发布时间的记录不再被顺手置成 null：那等于把线上产品撤下来
          .set('publishedAt', str(row.publishedAt) ? new Date(str(row.publishedAt) as string) : null)
          .build();

        const existing = await db.product.findUnique({ where: { slug }, select: { id: true } });
        if (existing) productTable.updated += 1;
        else productTable.created += 1;
        if (dryRun) continue;

        const saved = existing
          ? await db.product.update({ where: { id: existing.id }, data })
          : await db.product.create({
              data: { brandId, slug, ...data } as unknown as Prisma.ProductUncheckedCreateInput,
            });

        // 关联整组重建：删掉再加，避免残留上一次的旧关系。
        // 但 merge 模式下「远端没给这个字段」不等于「清空」——没 populate、content-type
        // 里根本没建这个字段，都会让 row 上压根没有这个键。此时保留本地关联。
        const scenarioKeys = ['scenarios', 'bestFor', 'best_for'];
        const scenarioProvided = scenarioKeys.some((k) => row[k] !== undefined && row[k] !== null);
        const scenarioSlugs = refSlugs(row.scenarios ?? row.bestFor ?? row.best_for);
        if (strict || (scenarioProvided && scenarioSlugs.length > 0)) {
          await db.productScenario.deleteMany({ where: { productId: saved.id } });
          for (const [order, sSlug] of scenarioSlugs.entries()) {
            const scenarioId = scenarioIdBySlug.get(sSlug);
            if (!scenarioId) {
              warnings.push(`产品 ${slug} 的场景 ${sSlug} 不存在，已忽略`);
              continue;
            }
            await db.productScenario.create({ data: { productId: saved.id, scenarioId, sortOrder: order } });
          }
        }

        const names = (value: unknown): string[] =>
          list(value)
            .map((v) => str(v))
            .filter((v): v is string => v !== null);
        // key_features 与 specs.ai_features 是两类，只同步前者会丢掉「支持哪些 AI 能力」。
        // 两类各自判定：远端只给了 key 时，不能顺手把 ai 那一组删掉。
        const featureGroups: { kind: 'key' | 'ai'; names: string[] }[] = [
          { kind: 'key', names: names(row.keyFeatures ?? row.key_features ?? row.features) },
          { kind: 'ai', names: names(row.aiFeatures ?? row.ai_features ?? specs.ai_features) },
        ];
        for (const group of featureGroups) {
          if (!strict && group.names.length === 0) continue;
          await db.productFeature.deleteMany({
            where: { productId: saved.id, feature: { kind: group.kind } },
          });
          let order = 0;
          for (const name of group.names) {
            const fSlug = slugify(name);
            if (!fSlug) continue;
            const feature = await db.feature.upsert({
              where: { slug: fSlug },
              // kind 只在创建时定，已存在的记录不因这次来源不同而改判
              update: { name },
              create: { slug: fSlug, name, kind: group.kind, sortOrder: order },
              select: { id: true },
            });
            await db.productFeature.create({
              data: { productId: saved.id, featureId: feature.id, sortOrder: order },
            });
            order += 1;
          }
        }
      }
      tables.push(productTable);

      // ---- FAQ ----
      const faqTable = emptyCounters('faq');
      faqTable.fetched = faqRows.length;
      for (const [i, raw] of faqRows.entries()) {
        const row = flatten(raw);
        if (!row) {
          faqTable.skipped += 1;
          continue;
        }
        if (row.publishedAt === null) {
          faqTable.skipped += 1;
          continue;
        }
        const question = str(row.question);
        const answer = str(row.answer);
        // 必须用我们自己定义的 legacyId 字段，不能用 row.id。
        // Strapi 的 id 是内部行号，开了 draftAndPublish 后草稿和已发布各占一行，
        // 发布行拿到的是 2/4/6… 这种偶数序列，跟本地 legacyId 全错位，
        // 结果就是「同一个 legacyId 问题却不同」→ 全部被判成撞号。
        const legacyId = num(row.legacyId ?? row.legacy_id);
        if (!question || !answer || legacyId === null) {
          faqTable.skipped += 1;
          warnings.push(`FAQ 第 ${i} 条缺少 legacyId / question / answer，已跳过`);
          continue;
        }
        const productSlug = refSlug(row.product);
        const seriesSlug = refSlug(row.series ?? row.productSeries);
        const scenarioSlug = refSlug(row.scenario);
        const product = productSlug ? await db.product.findUnique({ where: { slug: productSlug }, select: { id: true } }) : null;
        const series = seriesSlug
          ? await db.productSeries.findUnique({ where: { brandId_slug: { brandId, slug: seriesSlug } }, select: { id: true } })
          : null;
        const scenario = scenarioSlug ? await db.scenario.findUnique({ where: { slug: scenarioSlug }, select: { id: true } }) : null;

        const scope = product ? 'product' : series ? 'series' : scenario ? 'scenario' : null;
        const featured = row.isFeatured ?? row.is_featured;
        const data = new Patch(strict)
          .force('question', question)
          .force('answer', answer)
          .set('answerSummary', str(row.answerSummary ?? row.answer_summary))
          .set('sortOrder', num(row.sortOrder ?? row.sort_order), i)
          // scope 由关联派生：一个关联都没解析出来时不能写成 brand，那会把产品的 FAQ 变品牌级
          .set('scope', scope, 'brand')
          .set('productId', product?.id ?? null)
          .set('seriesId', series?.id ?? null)
          .set('scenarioId', scenario?.id ?? null)
          .set('isFeatured', featured === undefined || featured === null ? null : Boolean(featured), false)
          .build();

        const existing = await db.faq.findUnique({
          where: { legacyId },
          select: { id: true, question: true },
        });
        // legacyId 只是旧站的数字 id，两边各自从 1 开始自增，很容易撞。
        // 撞号时覆盖等于用别人的内容替换本地已有问答，宁可跳过并报出来。
        if (existing && mode === 'merge' && existing.question !== question) {
          faqTable.skipped += 1;
          warnings.push(
            `FAQ legacyId ${legacyId} 与本地既有条目撞号（问题不同），已跳过：${question.slice(0, 24)}…`,
          );
          continue;
        }
        if (existing) faqTable.updated += 1;
        else faqTable.created += 1;
        if (dryRun) continue;
        if (existing) await db.faq.update({ where: { id: existing.id }, data });
        else await db.faq.create({ data: { legacyId, brandId, ...data } as unknown as Prisma.FaqUncheckedCreateInput });
      }
      tables.push(faqTable);

      // ---- prune：远端已经没有、本地仍在的条目 ----------------------------
      // 默认关闭。开着做「一次性对齐」可以，但必须防住「Strapi 刚建好还是空的」
      // 这种开局——那一下会把整库清干净，且没有回收站。
      if (prune) {
        const remoteOf = (rows: Raw[]): Set<string> =>
          new Set(
            rows
              .map((r) => str(flatten(r)?.slug))
              .filter((v): v is string => typeof v === 'string' && v.length > 0),
          );

        const keepProducts = remoteOf(productRows);
        if (productRows.length === 0) {
          warnings.push('prune 跳过产品：远端返回 0 条，删空整库的风险太大');
        } else {
          const locals = await db.product.findMany({ select: { id: true, slug: true } });
          const ids = locals.filter((l) => !keepProducts.has(l.slug)).map((l) => l.id);
          pruned.products = ids.length;
          if (!dryRun && ids.length > 0) {
            await db.product.deleteMany({ where: { id: { in: ids } } });
          }
        }

        const keepSeries = remoteOf(seriesRows);
        if (seriesRows.length === 0) {
          warnings.push('prune 跳过系列：远端返回 0 条');
        } else {
          const locals = await db.productSeries.findMany({ select: { id: true, slug: true } });
          const ids = locals.filter((l) => !keepSeries.has(l.slug)).map((l) => l.id);
          pruned.series = ids.length;
          if (!dryRun && ids.length > 0) {
            // 系列上有 Restrict 外键：只删已经没有产品的，剩下的留给人处理
            const blocked = await db.productSeries.findMany({
              where: { id: { in: ids }, products: { some: {} } },
              select: { id: true },
            });
            const blockedIds = new Set(blocked.map((b) => b.id));
            const deletable = ids.filter((id) => !blockedIds.has(id));
            pruned.series -= blockedIds.size;
            if (blockedIds.size > 0) {
              warnings.push(`prune 有 ${blockedIds.size} 个系列仍挂着产品，已保留`);
            }
            if (deletable.length > 0) {
              await db.productSeries.deleteMany({ where: { id: { in: deletable } } });
            }
          }
        }

        const keepScenarios = remoteOf(scenarioRows);
        if (scenarioRows.length === 0) {
          warnings.push('prune 跳过场景：远端返回 0 条');
        } else {
          const locals = await db.scenario.findMany({ select: { id: true, slug: true } });
          const ids = locals.filter((l) => !keepScenarios.has(l.slug)).map((l) => l.id);
          pruned.scenarios = ids.length;
          if (!dryRun && ids.length > 0) {
            await db.scenario.deleteMany({ where: { id: { in: ids } } });
          }
        }
      }
    };

    const pruned = { products: 0, series: 0, scenarios: 0 };

    if (dryRun) {
      // dryRun 也要读库比对，但不开事务（不开事务才不会留下写锁）
      await apply(this.prisma as unknown as Prisma.TransactionClient);
    } else {
      await this.prisma.$transaction(apply, { timeout: 120_000 });
    }

    // 远端已删除的条目：报告出来，删不删由 prune 决定
    const missingInStrapi = await this.diffMissing(productRows, seriesRows, scenarioRows);

    const report: StrapiSyncReportDto = {
      baseUrl,
      dryRun,
      mode,
      durationMs: Date.now() - started,
      tables,
      warnings,
      missingInStrapi,
      pruned: prune ? pruned : null,
    };
    this.logger.log(
      `Strapi 同步${dryRun ? '（预演）' : ''}[${mode}]完成：${tables
        .map((t) => `${t.collection} +${t.created}/~${t.updated}`)
        .join(' · ')}${prune ? ` · 清理 ${pruned.products}/${pruned.series}/${pruned.scenarios}` : ''} · ${report.durationMs}ms`,
    );
    return report;
  }

  private async diffMissing(
    productRows: Raw[],
    seriesRows: Raw[],
    scenarioRows: Raw[],
  ): Promise<StrapiSyncReportDto['missingInStrapi']> {
    const slugsOf = (rows: Raw[], key = 'slug'): string[] =>
      rows
        .map((r) => str(flatten(r)?.[key]))
        .filter((v): v is string => typeof v === 'string' && v.length > 0);

    const remoteProducts = new Set(slugsOf(productRows));
    const remoteSeries = new Set(slugsOf(seriesRows));
    const remoteScenarios = new Set(slugsOf(scenarioRows));

    const [localProducts, localSeries, localScenarios] = await Promise.all([
      this.prisma.product.findMany({ select: { slug: true } }),
      this.prisma.productSeries.findMany({ select: { slug: true } }),
      this.prisma.scenario.findMany({ select: { slug: true } }),
    ]);

    return {
      products: localProducts.map((r) => r.slug).filter((s) => !remoteProducts.has(s)),
      series: localSeries.map((r) => r.slug).filter((s) => !remoteSeries.has(s)),
      scenarios: localScenarios.map((r) => r.slug).filter((s) => !remoteScenarios.has(s)),
    };
  }

  /**
   * Strapi 的 REST 端点名是 content-type 的 pluralName，不是 uid：
   * `api::product.product` 暴露成 `/api/products`，而不是 `/api/product`。
   * 这里单复数各试一次并记住命中的那个——本地 mock 用单数、真机用复数，
   * 硬编码任何一个都会在另一边 404。
   */
  private routeCandidates(collection: string): string[] {
    const override = process.env.STRAPI_ENDPOINTS?.trim();
    if (override) {
      for (const pair of override.split(',')) {
        const [key, value] = pair.split('=').map((s) => s.trim());
        if (key === collection && value) return [value];
      }
    }
    // 以 s 结尾的不再补 s（product-series 的复数是它自己）
    const plural = collection.endsWith('s') ? collection : `${collection}s`;
    return collection === plural ? [collection] : [collection, plural];
  }

  private async fetchAll(baseUrl: string, token: string, collection: string): Promise<Raw[]> {
    const cached = this.routeCache.get(collection);
    // 缓存命中过就优先它，但仍然保留其余候选：content-type 改过名、端点被改配置时，
    // 死守缓存会一直 404，而重新探测一次就能自愈
    const candidates = cached
      ? [cached, ...this.routeCandidates(collection).filter((c) => c !== cached)]
      : this.routeCandidates(collection);
    let lastStatus = 0;

    for (const route of candidates) {
      const url = `${baseUrl}/api/${route}?pagination[pageSize]=200&populate=*`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: token ? { authorization: `Bearer ${token}` } : {},
          signal: AbortSignal.timeout(20_000),
        });
      } catch (err) {
        throw new HttpException(
          `无法连接 Strapi（${route}）：${(err as Error).message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      if (res.status === 404) {
        lastStatus = 404;
        continue;
      }
      if (res.status === 401 || res.status === 403) {
        throw new HttpException(
          `Strapi 拒绝访问 ${route}（HTTP ${res.status}）：API Token 缺少 find 权限`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      if (!res.ok) {
        throw new HttpException(
          `Strapi 拉取 ${route} 失败：HTTP ${res.status}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      this.routeCache.set(collection, route);
      const json = (await res.json()) as { data?: unknown };
      return list(json?.data) as Raw[];
    }

    throw new HttpException(
      `Strapi 里找不到集合 ${collection}（试过 ${candidates.map((c) => `/api/${c}`).join(' 和 ')}），${lastStatus}：先在后台上建好这个 content-type，或用 STRAPI_ENDPOINTS 指定端点名`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
