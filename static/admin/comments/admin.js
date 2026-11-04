(() => {
  const $ = id => document.getElementById(id); let data, before = 0, busy = false;
  async function getJSON(url, options) {
    const response = await fetch(url, options); let result;
    try { result = await response.json(); } catch { throw new Error('Sign in through Cloudflare Access or reload your session.'); }
    if (!response.ok) throw new Error(result.error || 'Request failed.'); return result;
  }
  function date(seconds) { return seconds ? new Date(seconds * 1000).toLocaleString() : 'never'; }
  function postState() { const post = data.posts.find(p => p.id === $('post').value); $('post-toggle').textContent = post?.accepting ? 'Close this post' : 'Open this post'; }
  async function load() {
    data = await getJSON(`/api/admin/comments?status=${encodeURIComponent($('filter').value)}&before=${before}`);
    const pending = data.counts.find(c => c.status === 'pending');
    $('summary').textContent = `${data.counts.map(c => `${c.count} ${c.status}`).join(' · ') || 'No comments'} · ${data.admitted_today}/${data.settings.daily_limit} guest submissions today${pending ? ` · Oldest pending: ${date(pending.oldest)}` : ''}`;
    $('maintenance').textContent = `Cleanup: ${date(data.settings.last_cleanup)} · Backup: ${date(data.settings.last_backup)}${data.deployment_enabled ? '' : ' · Deployment switch is OFF'}`;
    $('pause').textContent = data.settings.accepting ? 'Pause submissions' : 'Open submissions'; $('pause').disabled = false;
    $('queue').replaceChildren();
    for (const comment of data.comments) {
      const article = document.createElement('article'); const label = document.createElement('label'); const check = document.createElement('input');
      check.type = 'checkbox'; check.value = comment.id; label.append(check, document.createTextNode(` ${comment.author}${comment.is_owner ? ' (Author)' : ''}`));
      const meta = document.createElement('small'); const link = document.createElement('a'); link.href = comment.url; link.textContent = comment.title; meta.append(link, document.createTextNode(` · ${date(comment.created_at)}`));
      const body = document.createElement('p'); body.textContent = comment.body; article.append(label, meta, body); $('queue').append(article);
    }
    if (!data.comments.length) $('queue').textContent = 'Nothing in this view.';
    $('more').hidden = data.next_before === null;
    const chosen = $('post').value; $('post').replaceChildren();
    for (const post of data.posts) { const option = document.createElement('option'); option.value = post.id; option.textContent = post.title; $('post').append(option); }
    if (data.posts.some(p => p.id === chosen)) $('post').value = chosen; postState();
  }
  async function mutate(payload) {
    if (busy) return; busy = true; $('status').textContent = 'Saving…';
    try { await getJSON('/api/admin/comments', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Comments-Admin': '1' }, body: JSON.stringify(payload) });
      before = 0; await load(); $('status').textContent = 'Saved.'; return true;
    } catch (error) { $('status').textContent = error.message; return false; } finally { busy = false; }
  }
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    const ids = [...document.querySelectorAll('#queue input:checked')].map(x => x.value); if (!ids.length) { $('status').textContent = 'Select comments first.'; return; }
    if (button.dataset.action === 'delete' && !confirm('Permanently delete the selected comments?')) return;
    mutate({ action: button.dataset.action, ids });
  }));
  $('pause').addEventListener('click', () => mutate({ action: 'settings', accepting: !data.settings.accepting }));
  $('post-toggle').addEventListener('click', () => { const post = data.posts.find(p => p.id === $('post').value); if (post) mutate({ action: 'post', post: post.id, accepting: !post.accepting }); });
  $('post').addEventListener('change', postState);
  $('filter').addEventListener('change', () => { before = 0; load().catch(e => $('status').textContent = e.message); });
  $('more').addEventListener('click', () => { before = data.next_before; load().catch(e => $('status').textContent = e.message); });
  $('owner-form').addEventListener('submit', async event => { event.preventDefault(); if (await mutate({ action: 'owner', post: $('post').value, body: $('owner-body').value })) $('owner-body').value = ''; });
  load().catch(error => { $('status').textContent = error.message; });
})();
