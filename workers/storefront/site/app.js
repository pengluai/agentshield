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

function setLang(lang) {
  body.dataset.lang = lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.langSwitch === lang);
  });
  if (langToggle) {
    langToggle.textContent = lang === 'zh' ? 'EN' : '中文';
  }
  localStorage.setItem('agentshield-site-lang', lang);
}

function syncTopbar() {
  if (!topbar) return;
  topbar.classList.toggle('scrolled', window.scrollY > 20);
}

function toggleMobileMenu(forceOpen) {
  if (!mobileMenu || !mobileToggle) return;
  const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !mobileMenu.classList.contains('open');
  mobileMenu.classList.toggle('open', shouldOpen);
  mobileToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

var savedLang = localStorage.getItem('agentshield-site-lang');
setLang(savedLang || detectBrowserLang());
syncTopbar();

window.addEventListener('scroll', syncTopbar, { passive: true });

tabs.forEach((tab) => {
  tab.addEventListener('click', () => setLang(tab.dataset.langSwitch));
});

if (langToggle) {
  langToggle.addEventListener('click', () => {
    setLang(body.dataset.lang === 'zh' ? 'en' : 'zh');
  });
}

if (mobileToggle) {
  mobileToggle.addEventListener('click', () => toggleMobileMenu());
}

mobileLinks.forEach((link) => {
  link.addEventListener('click', () => toggleMobileMenu(false));
});

faqTriggers.forEach((trigger) => {
  trigger.addEventListener('click', () => {
    const item = trigger.closest('.faq-item');
    if (!item) return;
    const isOpen = item.classList.contains('open');

    faqTriggers.forEach((otherTrigger) => {
      const otherItem = otherTrigger.closest('.faq-item');
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
