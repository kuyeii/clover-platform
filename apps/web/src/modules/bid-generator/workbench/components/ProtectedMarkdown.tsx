import type { ComponentProps, ImgHTMLAttributes } from 'react';
import { useEffect, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { resolveProtectedAssetUrl } from '../services/protectedAssetUrl';

type ReactMarkdownProps = ComponentProps<typeof ReactMarkdown>;

type ProtectedImageProps = ImgHTMLAttributes<HTMLImageElement> & {
    node?: unknown;
};

function ProtectedImage({ src, node: _node, ...props }: ProtectedImageProps) {
    const [resolvedSrc, setResolvedSrc] = useState(src || '');

    useEffect(() => {
        let cancelled = false;
        const value = String(src || '');
        if (!value) {
            setResolvedSrc('');
            return undefined;
        }
        resolveProtectedAssetUrl(value)
            .then((url) => {
                if (!cancelled) {
                    setResolvedSrc(url);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setResolvedSrc('');
                }
            });
        return () => {
            cancelled = true;
        };
    }, [src]);

    return <img {...props} src={resolvedSrc} />;
}

export function protectedMarkdownComponents(extra?: Components): Components {
    return {
        ...extra,
        img: (props) => <ProtectedImage {...props} />,
    };
}

export function ProtectedMarkdown({
    children,
    remarkPlugins,
    components,
}: {
    children: string;
    remarkPlugins?: ReactMarkdownProps['remarkPlugins'];
    components?: Components;
}) {
    return (
        <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={protectedMarkdownComponents(components)}
        >
            {children}
        </ReactMarkdown>
    );
}
