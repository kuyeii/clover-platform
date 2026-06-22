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
    filter: (node) => node.nodeName === 'DIAGRAM',
    replacement: function (_content, node) {
        const el = node as HTMLElement;
        const type = el.getAttribute('type') || '';
        const title = el.getAttribute('title') || '';
        const diagramId = el.getAttribute('data-diagram-id') || '';
        const inner = el.innerHTML || '';
        if (diagramId && !inner) {
            // Artifact 图表只保存引用，避免把大段 SVG 写回正文。
            return `\n<diagram data-diagram-id="${diagramId}" type="${type}" title="${title}"></diagram>\n`;
        }
        return `\n<diagram type="${type}" title="${title}">${inner}</diagram>\n`;
    }
});

export default turndownService;
