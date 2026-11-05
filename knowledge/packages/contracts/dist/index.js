"use strict";
/**
 * 前后端共享的接口契约（纯类型，零运行时依赖）。
 *
 * 之所以手写不引 codegen：这份契约只有十几个形状，手写可读性更好，
 * 也少一层构建产物。api 侧的 DTO 类 implements 这些类型，
 * web 侧直接 import type —— 任一侧改字段不同步就编译不过。
 */
Object.defineProperty(exports, "__esModule", { value: true });
