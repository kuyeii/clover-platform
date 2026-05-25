/**
 * PlaceholderHighlight — Tiptap 占位符高亮扩展
 * 匹配所有 {{...}} 格式的占位符（PIPT 脱敏、BID 投标人等）
 *
 * 特性：
 * - 纯渲染层 Decoration，不修改底层文档数据
 * - 占位符区域 contenteditable=false，不可内部编辑
 * - user-select:all，点击即选中整块，可整体删除
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

// 通用占位符正则：匹配所有 {{...}} 格式（非贪婪，不跨行）
const PLACEHOLDER_REGEX = /\{\{[^}]+\}\}/g;

const placeholderPlugin = new Plugin({
    key: new PluginKey('placeholderHighlight'),
    props: {
        decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
                if (!node.isText || !node.text) return;
                let match;
                PLACEHOLDER_REGEX.lastIndex = 0;
                while ((match = PLACEHOLDER_REGEX.exec(node.text)) !== null) {
                    const from = pos + match.index;
                    const to = from + match[0].length;
                    decorations.push(
                        Decoration.inline(from, to, {
                            class: 'pipt-placeholder',
                            'data-placeholder': match[0],
                            contenteditable: 'false',
                        })
                    );
                }
            });
            return DecorationSet.create(state.doc, decorations);
        },
    },
});

/**
 * PlaceholderHighlight — 注册为 Tiptap Extension（不是 Node）
 * 纯插件挂载，无 schema 定义
 */
export const PlaceholderHighlight = Extension.create({
    name: 'placeholderHighlight',

    addProseMirrorPlugins() {
        return [placeholderPlugin];
    },
});
