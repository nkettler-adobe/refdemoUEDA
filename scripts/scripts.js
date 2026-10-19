import {
  loadHeader,
  loadFooter,
  decorateButtons as libDecorateButtons,
  decorateIcons,
  decorateSections,
  decorateBlocks,
  decorateTemplateAndTheme,
  waitForFirstImage,
  loadSection,
  loadSections,
  loadCSS,
  fetchPlaceholders,
  getMetadata,
  createOptimizedPicture,
} from './aem.js';
import { picture, source, img } from './dom-helpers.js';

import {
  getLanguage,
  formatDate,
  PATH_PREFIX,
} from './utils.js';

/**
 * Moves all the attributes from a given elmenet to another given element.
 * @param {Element} from the element to copy attributes from
 * @param {Element} to the element to copy attributes to
 */
export function moveAttributes(from, to, attributes) {
  if (!attributes) {
    // eslint-disable-next-line no-param-reassign
    attributes = [...from.attributes].map(({ nodeName }) => nodeName);
  }
  attributes.forEach((attr) => {
    const value = from.getAttribute(attr);
    if (value) {
      to.setAttribute(attr, value);
      from.removeAttribute(attr);
    }
  });
}

function whatBlockIsThis(element) {
  let currentElement = element;

  while (currentElement.parentElement) {
    if (currentElement.parentElement.classList.contains('block')) return currentElement.parentElement;
    currentElement = currentElement.parentElement;
    if (currentElement.classList.length > 0) return currentElement.classList[0];
  }
  return null;
}

export function isAuthorEnvironment() {
  if (window?.location?.origin?.includes('author')) {
    return true;
  }
  return false;
}

/**
 * Move instrumentation attributes from a given element to another given element.
 * @param {Element} from the element to copy attributes from
 * @param {Element} to the element to copy attributes to
 */
export function moveInstrumentation(from, to) {
  moveAttributes(
    from,
    to,
    [...from.attributes]
      .map(({ nodeName }) => nodeName)
      .filter((attr) => attr.startsWith('data-aue-') || attr.startsWith('data-richtext-')),
  );
}

/**
 * load fonts.css and set a session storage flag
 */
async function loadFonts() {
  await loadCSS(`${window.hlx.codeBasePath}/styles/fonts.css`);
  try {
    if (!window.location.hostname.includes('localhost')) sessionStorage.setItem('fonts-loaded', 'true');
  } catch (e) {
    // do nothing
  }
}

const IMAGE_EXTENSION = /\.(avif|gif|jpe?g|png|svg|webp)$/i;
const ASSET_UUID = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;

/**
 * Classifies a link as an AEM image asset.
 * @param {URL} url the link URL
 * @returns {string|null} 'delivery' for a Dynamic Media delivery image,
 * 'dam' for an author/publish DAM image, or null for anything else
 */
function getAemImageType(url) {
  const { hostname } = url;
  const pathname = decodeURIComponent(url.pathname);
  if (!hostname.endsWith('.adobeaemcloud.com') || !IMAGE_EXTENSION.test(pathname)) return null;
  if (hostname.startsWith('delivery-p') && ASSET_UUID.test(pathname)) return 'delivery';
  if (/^(author|publish)-p\d+-e\d+\./.test(hostname) && pathname.startsWith('/content/dam/')) return 'dam';
  return null;
}

/**
 * Builds a responsive picture for a Dynamic Media delivery URL.
 * Rotate, flip and crop come from the dynamicmedia-image block, when present.
 * @param {URL} url the delivery URL
 * @param {string} alt the alt text
 * @param {Element} a the link being replaced
 * @returns {Element} the picture
 */
function buildDeliveryPicture(url, alt, a) {
  const dmBlock = a.closest('.dynamicmedia-image');
  const rotate = dmBlock?.children[3]?.textContent?.trim();
  const flip = dmBlock?.children[4]?.textContent?.trim();
  const crop = dmBlock?.children[5]?.textContent?.trim();
  const params = `${rotate ? `&rotate=${rotate}` : ''}${flip ? `&flip=${flip.toLowerCase()}` : ''}${crop ? `&crop=${crop.toLowerCase()}` : ''}`;
  const href = `${url.origin}${url.pathname}`;
  const hrefWOExtn = href.substring(0, href.lastIndexOf('.')).replace(/\/original\/(?=as\/)/, '/');
  const widths = [['1400', '(min-width: 992px)'], ['1320', '(min-width: 768px)'], ['780', '(min-width: 320px)']];
  return picture(
    ...widths.map(([width, media]) => source({
      srcset: `${hrefWOExtn}.webp?width=${width}&quality=85&preferwebp=true${params}`,
      type: 'image/webp',
      media,
    })),
    ...widths.map(([width, media]) => source({
      srcset: `${hrefWOExtn}.webp?width=${width}&quality=85${params}`,
      media,
    })),
    img({ src: `${hrefWOExtn}.webp?width=1400&quality=85${params}`, alt }),
  );
}

/**
 * Turns links to AEM image assets into pictures, so blocks receive the same
 * markup as an image uploaded to the document. Handles DAM links
 * (publish/author /content/dam/...) and Dynamic Media delivery links, which
 * is what the DA asset picker inserts when aem.assets.image.type is "link".
 * The link text becomes the alt text, unless it is just the URL.
 * @param {Element} main the container element
 */
export function decorateAemAssets(main) {
  main.querySelectorAll('a[href*=".adobeaemcloud.com/"]').forEach((a) => {
    if (a.querySelector('img, picture')) return;
    let url;
    try {
      url = new URL(a.href);
    } catch (e) {
      return;
    }
    const type = getAemImageType(url);
    if (!type) return;
    const text = a.textContent.trim();
    const alt = (text && !text.startsWith('http')) ? text : (a.title || '');
    const pictureEl = type === 'delivery'
      ? buildDeliveryPicture(url, alt, a)
      : picture(img({ src: a.href, alt, loading: 'lazy' }));
    a.replaceWith(pictureEl);
  });
}

/**
 * Return the placeholder file specific to language
 * @returns
 */
export async function fetchLanguagePlaceholders() {
  const langCode = getLanguage();
  try {
    // Try fetching placeholders with the specified language
    return await fetchPlaceholders(`${PATH_PREFIX}/${langCode}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Error fetching placeholders for lang: ${langCode}. Will try to get en placeholders`, error);
    // Retry without specifying a language (using the default language)
    try {
      return await fetchPlaceholders(`${PATH_PREFIX}/en`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Error fetching placeholders:', err);
    }
  }
  return {}; // default to empty object
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function buildAutoBlocks() {
  try {
    // TODO: add auto block, if needed
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto Blocking failed', error);
  }
}

/**
 * Builds all synthetic blocks in a container element.
 * @param {Element} main The container element
 */
function decorateButtons(main) {
  main.querySelectorAll('img').forEach((InnerImg) => {
    let altT = decodeURIComponent(InnerImg.alt);

    if (altT && altT.includes('https://delivery-')) {
      try {
        altT = JSON.parse(altT);
        const { altText, deliveryUrl } = altT;
        const url = new URL(deliveryUrl);
        const imgName = url.pathname.substring(url.pathname.lastIndexOf('/') + 1);
        const block = whatBlockIsThis(InnerImg);
        const bp = getMetadata(block);
        let breakpoints = [{ media: '(min-width: 600px)', width: '2000' }, { width: '750' }];
        if (bp) {
          const bps = bp.split('|');
          const bpS = bps.map((b) => b.split(',').map((p) => p.trim()));
          breakpoints = bpS.map((n) => {
            const obj = {};
            n.forEach((i) => {
              const t = i.split(/:(.*)/s);
              obj[t[0].trim()] = t[1].trim();
            });
            return obj;
          });
        } else {
          const format = getMetadata(imgName.toLowerCase().replace('.', '-'));
          const formats = format.split('|');
          const formatObj = {};
          formats.forEach((i) => {
            const [a, b] = i.split('=');
            formatObj[a] = b;
          });
          breakpoints = breakpoints.map((n) => (
            { ...n, ...formatObj }
          ));
        }
        const newPicture = createOptimizedPicture(deliveryUrl, altText, false, breakpoints);
        InnerImg.parentElement.replaceWith(newPicture);
      } catch (error) {
        InnerImg.setAttribute('style', 'border:5px solid red');
        InnerImg.setAttribute('data-asset-type', 'video');
        InnerImg.setAttribute('title', 'Update block to render video.');
      }
    }
  });
  libDecorateButtons(main);
}

/**
 * Decorates the main element.
 * @param {Element} main The main element
 */
// eslint-disable-next-line import/prefer-default-export
export function decorateMain(main) {
  // AEM asset links become pictures before buttons and blocks are decorated
  decorateAemAssets(main);
  // hopefully forward compatible button decoration
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateSections(main);
  decorateBlocks(main);
}

async function renderWBDataLayer() {
  const lastPubDateStr = getMetadata('published-time');
  const firstPubDateStr = getMetadata('content_date') || lastPubDateStr;
  window.wbgData.page = {
    pageInfo: {
      pageCategory: getMetadata('pagecategory'),
      channel: getMetadata('channel'),
      themecfreference: getMetadata('theme_cf_reference'),
      contentType: getMetadata('content_type'),
      pageUid: getMetadata('pageuid'),
      pageName: getMetadata('pagename'),
      hostName: getMetadata('hostname'),
      pageFirstPub: formatDate(firstPubDateStr),
      pageLastMod: formatDate(lastPubDateStr),
      webpackage: '',
    },
  };
}

/**
 * Loads everything needed to get to LCP.
 * @param {Element} doc The container element
 */
async function loadEager(doc) {
  document.documentElement.lang = 'en';
  decorateTemplateAndTheme();
  renderWBDataLayer();
  const main = doc.querySelector('main');
  if (main) {
    decorateMain(main);
    document.body.classList.add('appear');
    await loadSection(main.querySelector('.section'), waitForFirstImage);
  }

  try {
    /* if desktop (proxy for fast connection) or fonts already loaded, load fonts.css */
    if (window.innerWidth >= 900 || sessionStorage.getItem('fonts-loaded')) {
      loadFonts();
    }
  } catch (e) {
    // do nothing
  }
}

/**
 * Loads everything that doesn't need to be delayed.
 * @param {Element} doc The container element
 */
async function loadLazy(doc) {
  const main = doc.querySelector('main');
  await loadSections(main);

  const { hash } = window.location;
  const element = hash ? doc.getElementById(hash.substring(1)) : false;
  if (hash && element) element.scrollIntoView();

  loadHeader(doc.querySelector('header'));
  loadFooter(doc.querySelector('footer'));

  loadCSS(`${window.hlx.codeBasePath}/styles/lazy-styles.css`);
  loadFonts();
}

/**
 * Loads everything that happens a lot later,
 * without impacting the user experience.
 */
function loadDelayed() {
  // eslint-disable-next-line import/no-cycle
  window.setTimeout(() => import('./delayed.js'), 3000);
  // load anything that can be postponed to the latest here
}

async function loadPage() {
  window.wbgData ||= {};
  await loadEager(document);
  await loadLazy(document);
  loadDelayed();
}

loadPage();

(async function loadDa() {
  if (!new URL(window.location.href).searchParams.get('dapreview')) return;
  // eslint-disable-next-line import/no-unresolved
  import('https://da.live/scripts/dapreview.js').then(({ default: daPreview }) => daPreview(loadPage));
}());
