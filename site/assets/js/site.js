// vicu.app: theme toggle, header border, tour tabs, the quick-add demo and scroll reveals.
// Makes no requests.
(function () {
  var root = document.documentElement;
  var dark = window.matchMedia('(prefers-color-scheme: dark)');

  // Theme: follows the system until the visitor picks one.
  var toggle = document.querySelector('.theme-toggle');
  function isDark() {
    var t = root.getAttribute('data-theme');
    return t ? t === 'dark' : dark.matches;
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = isDark() ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try {
        localStorage.setItem('vicu-site-theme', next);
      } catch (e) {}
    });
  }

  // Header border once the page scrolls.
  var header = document.querySelector('.site-header');
  function onScroll() {
    if (header) header.classList.toggle('scrolled', window.scrollY > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Tour tabs (arrow keys, Home and End move between them).
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role="tab"]'));
  function select(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      var panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      select(tab, false);
    });
    tab.addEventListener('keydown', function (e) {
      var to = null;
      if (e.key === 'ArrowRight') to = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') to = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') to = tabs[0];
      else if (e.key === 'End') to = tabs[tabs.length - 1];
      if (to) {
        e.preventDefault();
        select(to, true);
      }
    });
  });

  // Quick-add demo: each example is the typed text (plain and token parts) and the chips it makes.
  var demos = [
    {
      parts: [['Call Ana about the weekend '], ['tomorrow 3pm', 'date'], [' '], ['@call', 'label'], [' '], ['!high', 'prio']],
      chips: [['Tomorrow, 15:00', 'date'], ['High', 'prio'], ['call', 'label']],
    },
    {
      parts: [['Water the plants '], ['every 3 days', 'rep']],
      chips: [['Today', 'date'], ['Every 3 days', 'rep']],
    },
    {
      parts: [['Book flights '], ['#lisbon', 'proj'], [' '], ['friday', 'date']],
      chips: [['Friday', 'date'], ['Trip to Lisbon', 'proj']],
    },
    {
      parts: [['Call mom '], ['when I get home', 'label']],
      chips: [['Arrive: Home', 'label']],
    },
  ];
  var text = document.getElementById('demo-text');
  var chips = document.getElementById('demo-chips');
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-demo]'));
  function span(content, kind, chip) {
    var s = document.createElement('span');
    s.textContent = content;
    if (kind) s.className = (chip ? 'chip ' : 't ') + 't--' + kind;
    return s;
  }
  function show(n) {
    var d = demos[n];
    if (!d || !text || !chips) return;
    text.textContent = '';
    d.parts.forEach(function (p) {
      text.appendChild(span(p[0], p[1], false));
    });
    var caret = document.createElement('span');
    caret.className = 'caret';
    caret.setAttribute('aria-hidden', 'true');
    text.appendChild(caret);
    chips.textContent = '';
    d.chips.forEach(function (c) {
      chips.appendChild(span(c[0], c[1], true));
    });
    buttons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-demo')) === n));
    });
  }
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      show(Number(b.getAttribute('data-demo')));
    });
  });

  // Reveal on scroll.
  var items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    items.forEach(function (el) {
      el.classList.add('in');
    });
    return;
  }
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  items.forEach(function (el) {
    io.observe(el);
  });
})();
