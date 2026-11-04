(() => {
  const section = document.getElementById('comments'); if (!section) return;
  const list = document.getElementById('comments-list'); const form = document.getElementById('comments-form');
  const status = document.getElementById('comments-status'); const loading = document.getElementById('comments-loading');
  const more = document.getElementById('comments-more'); const submit = document.getElementById('comments-submit');
  let cursor = null, widget = null, token = '', requestID = null, lastPayload = null, busy = false;
  async function responseJSON(response) {
    let data; try { data = await response.json(); } catch { throw new Error('Comments are temporarily unavailable. Please try again later.'); }
    if (!response.ok) throw new Error(data.error || 'Comments are temporarily unavailable. Please try again later.');
    return data;
  }
  function addComment(comment) {
    const li = document.createElement('li'); li.id = `comment-${comment.id}`;
    const meta = document.createElement('div'); meta.className = 'comment-meta';
    const author = document.createElement('strong'); author.textContent = comment.author; meta.append(author);
    if (comment.is_owner) { const badge = document.createElement('span'); badge.className = 'comment-owner'; badge.textContent = 'Author'; meta.append(badge); }
    const date = document.createElement('time'); const time = new Date(comment.created_at * 1000);
    date.dateTime = time.toISOString(); date.textContent = time.toLocaleDateString(undefined, { dateStyle: 'medium' }); meta.append(date);
    const body = document.createElement('p'); body.className = 'comment-text'; body.textContent = comment.body; li.append(meta, body); list.append(li);
  }
  async function challenge(siteKey) {
    if (widget !== null) return;
    try {
      if (!window.turnstile) await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true; script.onload = resolve; script.onerror = reject; document.head.append(script);
      });
      widget = window.turnstile.render('#comments-challenge', { sitekey: siteKey, action: 'comment', theme: 'auto',
        callback: value => { token = value; submit.disabled = busy; },
        'expired-callback': () => { token = ''; submit.disabled = true; },
        'error-callback': () => { token = ''; submit.disabled = true; status.textContent = 'The spam check could not load. Please reload to try again; your text is still here.'; },
      });
    } catch { status.textContent = 'The spam check could not load. Please reload to try again.'; }
  }
  async function load() {
    more.disabled = true;
    try {
      const url = new URL('/api/comments', location.origin); url.searchParams.set('post', section.dataset.post);
      if (cursor) url.searchParams.set('cursor', cursor);
      const data = await responseJSON(await fetch(url));
      data.comments.forEach(addComment); cursor = data.next_cursor; more.hidden = !cursor;
      loading.textContent = list.children.length ? '' : 'No comments yet.';
      form.hidden = !data.accepting;
      if (data.accepting) {
        const contact = document.getElementById('comments-contact'); contact.replaceChildren();
        if (data.contact) { const link = document.createElement('a'); link.href = `mailto:${data.contact}`; link.textContent = 'Contact the owner to request removal.'; contact.append(link); }
        await challenge(data.site_key);
      } else status.textContent = 'New comments are currently paused.';
    } catch (error) { loading.textContent = error.message; }
    finally { more.disabled = false; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !token) return;
    const payload = { post: section.dataset.post, author: form.elements.author.value, body: form.elements.body.value };
    const fingerprint = JSON.stringify(payload);
    if (fingerprint !== lastPayload) { requestID = crypto.randomUUID(); lastPayload = fingerprint; }
    busy = true; submit.disabled = true; status.textContent = 'Submitting…';
    try {
      await responseJSON(await fetch('/api/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, request_id: requestID, turnstile_token: token }) }));
      form.reset(); requestID = null; lastPayload = null;
      status.textContent = 'Thanks—your comment is awaiting review.';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; token = ''; submit.disabled = true; if (widget !== null) window.turnstile.reset(widget); }
  });
  more.addEventListener('click', load); load();
})();
