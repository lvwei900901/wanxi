"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbPath = dbPath;
exports.databaseUrl = databaseUrl;
exports.sourceDir = sourceDir;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function findRepoRoot(start) {
    let dir = start;
    for (let i = 0; i < 8; i += 1) {
        const pkg = (0, node_path_1.resolve)(dir, 'package.json');
        if ((0, node_fs_1.existsSync)(pkg)) {
            try {
                const json = JSON.parse((0, node_fs_1.readFileSync)(pkg, 'utf8'));
                if (json.workspaces)
                    return dir;
            }
            catch {
            }
        }
        const parent = (0, node_path_1.resolve)(dir, '..');
        if (parent === dir)
            break;
        dir = parent;
    }
    throw new Error(`无法定位仓库根目录（从 ${start} 向上未找到 workspaces 声明）`);
}
function dbPath() {
    return process.env.KNOWLEDGE_DB_PATH
        ? (0, node_path_1.resolve)(process.env.KNOWLEDGE_DB_PATH)
        : (0, node_path_1.resolve)(findRepoRoot(__dirname), 'data', 'knowledge.db');
}
function databaseUrl() {
    const url = process.env.DATABASE_URL ?? `file:${dbPath()}`;
    process.env.DATABASE_URL = url;
    return url;
}
function sourceDir() {
    return process.env.KNOWLEDGE_DATA_DIR
        ? (0, node_path_1.resolve)(process.env.KNOWLEDGE_DATA_DIR)
        : (0, node_path_1.resolve)(findRepoRoot(__dirname), 'data', 'source');
}
//# sourceMappingURL=db-path.js.map