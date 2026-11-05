"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("../app.module");
const index_service_1 = require("../modules/index/index.service");
async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const force = args.includes('--force');
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, {
        logger: ['error', 'warn'],
    });
    try {
        const index = app.get(index_service_1.IndexService);
        const result = await index.reindex({ dryRun, force, log: (m) => console.log(m) });
        if (dryRun) {
            console.log(`\n计划：共 ${result.total} 块 · 新增 ${result.added} · 变更 ${result.updated} · 未变 ${result.unchanged} · 待删除 ${result.removed}`);
        }
        else {
            console.log(`\n✓ 索引 v${result.version} 已生效 · ${result.total} 块（重算 ${result.embeddedChunks}）· 耗时 ${result.durationMs}ms`);
            const rv = result.revalidate;
            console.log(rv
                ? `ISR 失效：${rv.status}${rv.statusCode ? `（${rv.statusCode}）` : ''} · ${rv.tags.join(',')}` +
                    `${rv.message ? ` · ${rv.message}` : ''}`
                : 'ISR 失效：dryRun，跳过');
        }
    }
    finally {
        await app.close();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=reindex.js.map