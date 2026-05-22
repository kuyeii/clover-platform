import { forwardRef, useEffect, useState, type IframeHTMLAttributes } from 'react';
import { resolveProtectedAssetUrl } from '../services/protectedAssetUrl';

interface ProtectedIframeProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'src'> {
    src: string;
}

function splitHash(src: string) {
    const hashIndex = src.indexOf('#');
    if (hashIndex < 0) {
        return { path: src, hash: '' };
    }
    return {
        path: src.slice(0, hashIndex),
        hash: src.slice(hashIndex),
    };
}

export const ProtectedIframe = forwardRef<HTMLIFrameElement, ProtectedIframeProps>(function ProtectedIframe(
    { src, ...props },
    ref,
) {
    const [resolvedSrc, setResolvedSrc] = useState('');

    useEffect(() => {
        let cancelled = false;
        const { path, hash } = splitHash(src);
        setResolvedSrc('');
        resolveProtectedAssetUrl(path)
            .then((url) => {
                if (!cancelled) {
                    setResolvedSrc(`${url}${hash}`);
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

    return <iframe {...props} ref={ref} src={resolvedSrc || 'about:blank'} />;
});
