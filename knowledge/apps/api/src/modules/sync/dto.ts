import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class StrapiSyncDto {
  /** 只比对不写库，用来确认字段映射是否对得上 */
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** 同步完成后是否立即重建索引，默认 true——只同步不重建，站点看到的还是旧内容 */
  @IsOptional()
  @IsBoolean()
  rebuild?: boolean;

  /**
   * 写入模式，默认 merge。
   * merge 只写远端给出非空值的字段，本地补充的内容不会被残缺的远端数据抹掉；
   * mirror 整字段覆盖 + 关联整组重建，Strapi 为唯一权威源。
   */
  @IsOptional()
  @IsIn(['merge', 'mirror'])
  mode?: 'merge' | 'mirror';

  /** 删除远端已没有的本地条目。默认 false，且远端对应集合必须返回非空才生效 */
  @IsOptional()
  @IsBoolean()
  prune?: boolean;
}
