// Points the download links at the files of the latest GitHub release and highlights the visitor's OS.
// Without JavaScript, or if GitHub's API is unreachable, every link still goes to the releases page.
(function () {
  const REPO = 'faridmasjedi/NomadCue';

  function detectOs() {
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent;
    if (/mac/i.test(p)) return 'mac';
    if (/win/i.test(p)) return 'windows';
    if (/linux|x11/i.test(p) && !/android/i.test(navigator.userAgent)) return 'linux';
    return null;
  }

  const os = detectOs();
  const box = os && document.querySelector(`.dl[data-os="${os}"]`);
  if (box) {
    box.classList.add('mine');
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = 'Your system';
    box.querySelector('h3').appendChild(tag);
    const hero = document.getElementById('heroDownload');
    if (hero) hero.textContent = 'Download for ' + { mac: 'macOS', windows: 'Windows', linux: 'Linux' }[os];
  }

  const size = (b) => (b > 1048576 ? Math.round(b / 1048576) + ' MB' : Math.round(b / 1024) + ' KB');

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((rel) => {
      for (const a of document.querySelectorAll('[data-asset]')) {
        const asset = rel.assets.find((x) => x.name.endsWith(a.dataset.asset));
        if (!asset) continue;
        a.href = asset.browser_download_url;
        a.querySelector('span').textContent = size(asset.size);
        a.title = asset.name;
      }
      const date = new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      document.getElementById('releaseLine').innerHTML =
        `Latest version: <b>${rel.tag_name}</b>, released ${date}. <a href="${rel.html_url}">Release notes</a> · <a href="https://github.com/${REPO}/releases">all versions</a>`;
      // On macOS the hero button can't tell Apple Silicon from Intel, so it scrolls to the choice.
      if (os === 'windows' || os === 'linux') {
        const first = box.querySelector('[data-asset]');
        const hero = document.getElementById('heroDownload');
        if (hero && first) hero.href = first.href;
      }
    })
    .catch(() => {});
})();
