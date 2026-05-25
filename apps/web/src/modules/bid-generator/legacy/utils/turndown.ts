import TurndownService from 'turndown';
// @ts-ignore - turndown-plugin-gfm lacks official type definitions
import { gfm } from 'turndown-plugin-gfm';

const turndownService = new TurndownService({
    headingStyle: 'atx', // Use # instead of ====
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*'
});

// Enable Github Flavored Markdown (tables, strikethrough, etc.)
turndownService.use(gfm);

// Protect <diagram> tags from being escaped by Turndown
turndownService.addRule('diagrams', {
    filter: (node: Node) => node.nodeName === 'DIAGRAM',
    replacement: function (_content: string, node: Node) {
        const el = node as HTMLElement;
        const type = el.getAttribute('type') || '';
        const title = el.getAttribute('title') || '';
        // 保留图表内部原始 SVG，避免二次编辑/保存后图表内容丢失
        const inner = el.innerHTML || '';
        return `\n<diagram type="${type}" title="${title}">${inner}</diagram>\n`;
    }
});

export default turndownService;
