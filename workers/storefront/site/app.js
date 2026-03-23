const body = document.body;
const tabs = Array.from(document.querySelectorAll('[data-lang-switch]'));
const langToggle = document.getElementById('lang-toggle');
const topbar = document.querySelector('.topbar');
const mobileToggle = document.querySelector('.mobile-menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');
const faqTriggers = Array.from(document.querySelectorAll('.faq-trigger'));
const mobileLinks = Array.from(document.querySelectorAll('.mobile-link, .mobile-cta'));

function detectBrowserLang() {
  var navLang = (navigator.language || navigator.userLanguage || '').toLowerCase();
  return navLang.startsWith('zh') ? 'zh' : 'en';
}

/** Force-apply display on every .lang-block element via JS (bypass CSS issues) */
function applyLangDisplay(lang) {
  var allBlocks = document.querySelectorAll('.lang-block');
  for (var i = 0; i < allBlocks.length; i++) {
    var el = allBlocks[i];
    var isZh = el.classList.contains('zh');
    var isEn = el.classList.contains('en');
    if (lang === 'zh') {
      if (isZh) {
        el.style.display = el.tagName === 'SPAN' ? 'inline' : 'block';
      } else if (isEn) {
        el.style.display = 'none';
      }
    } else {
      if (isEn) {
        el.style.display = el.tagName === 'SPAN' ? 'inline' : 'block';
      } else if (isZh) {
        el.style.display = 'none';
      }
    }
  }
}

function setLang(lang) {
  body.dataset.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  tabs.forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.langSwitch === lang);
  });
  if (langToggle) {
    langToggle.textContent = lang === 'zh' ? 'EN' : '中文';
  }
  localStorage.setItem('agentshield-site-lang', lang);
  applyLangDisplay(lang);
}

function syncTopbar() {
  if (!topbar) return;
  topbar.classList.toggle('scrolled', window.scrollY > 20);
}

function toggleMobileMenu(forceOpen) {
  if (!mobileMenu || !mobileToggle) return;
  var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !mobileMenu.classList.contains('open');
  mobileMenu.classList.toggle('open', shouldOpen);
  mobileToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

var savedLang = localStorage.getItem('agentshield-site-lang');
setLang(savedLang || detectBrowserLang());
syncTopbar();

window.addEventListener('scroll', syncTopbar, { passive: true });

tabs.forEach(function(tab) {
  tab.addEventListener('click', function() { setLang(tab.dataset.langSwitch); });
});

if (langToggle) {
  langToggle.addEventListener('click', function() {
    setLang(body.dataset.lang === 'zh' ? 'en' : 'zh');
  });
}

if (mobileToggle) {
  mobileToggle.addEventListener('click', function() { toggleMobileMenu(); });
}

mobileLinks.forEach(function(link) {
  link.addEventListener('click', function() { toggleMobileMenu(false); });
});

faqTriggers.forEach(function(trigger) {
  trigger.addEventListener('click', function() {
    var item = trigger.closest('.faq-item');
    if (!item) return;
    var isOpen = item.classList.contains('open');

    faqTriggers.forEach(function(otherTrigger) {
      var otherItem = otherTrigger.closest('.faq-item');
      if (!otherItem) return;
      otherItem.classList.remove('open');
      otherTrigger.setAttribute('aria-expanded', 'false');
    });

    if (!isOpen) {
      item.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
  });
});
