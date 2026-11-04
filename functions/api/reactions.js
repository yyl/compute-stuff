function isValidSlug(slug) {
    if (!slug || typeof slug !== 'string') return false;
    if (slug.length > 100) return false;
    // Allow alphanumeric characters and hyphens
    const slugRegex = /^[a-z0-9-]+$/i;
    return slugRegex.test(slug);
}

async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const slug = url.searchParams.get('slug');
    const slugs = url.searchParams.get('slugs');

    // Batch mode: ?slugs=slug1,slug2,slug3
    if (slugs) {
        const slugList = slugs.split(',').filter(isValidSlug).slice(0, 100);
        const results = {};
        await Promise.all(
            slugList.map(async (s) => {
                const data = await env.REACTIONS.get(`reactions:${s}`, 'json');
                results[s] = data || { likes: 0, dislikes: 0 };
            })
        );
        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Single mode: ?slug=myslug
    if (!isValidSlug(slug)) {
        return new Response(
            JSON.stringify({ error: 'Invalid or missing slug parameter (alphanumeric and hyphens only, max 100 chars)' }),
            {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            }
        );
    }

    const data = await env.REACTIONS.get(`reactions:${slug}`, 'json');
    const reactions = data || { likes: 0, dislikes: 0 };

    return new Response(JSON.stringify(reactions), {
        headers: { 'Content-Type': 'application/json' },
    });
}

async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { slug, type, undo } = body;

    if (!isValidSlug(slug) || !['like', 'dislike'].includes(type)) {
        return new Response(
            JSON.stringify({ error: 'Invalid slug or type (slug must be alphanumeric/hyphens, max 100 chars; type must be "like" or "dislike")' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
    }

    const key = `reactions:${slug}`;
    const data = await env.REACTIONS.get(key, 'json');
    const reactions = data || { likes: 0, dislikes: 0 };

    if (undo) {
        // Undo a previous reaction (decrement)
        if (type === 'like') {
            reactions.likes = Math.max(0, reactions.likes - 1);
        } else {
            reactions.dislikes = Math.max(0, reactions.dislikes - 1);
        }
    } else {
        if (type === 'like') {
            reactions.likes += 1;
        } else {
            reactions.dislikes += 1;
        }
    }

    await env.REACTIONS.put(key, JSON.stringify(reactions));

    return new Response(JSON.stringify(reactions), {
        headers: { 'Content-Type': 'application/json' },
    });
}

export { onRequestGet, onRequestPost };
