#!/usr/bin/env python3
"""
Patch all HTML pages to add:
1. i18n.js script tag (before app.js or before </body>)
2. lang-switch HTML in the masthead (after .mast-nav div)
3. data-i18n attributes on nav links and key elements
"""
import re, os

LANG_SWITCH = '''    <div class="lang-switch">
      <button class="lang-current mono" aria-expanded="false" aria-controls="lang-menu">
        <span data-lang-current>EN</span>
        <span aria-hidden="true">▾</span>
      </button>
      <ul class="lang-menu" id="lang-menu" hidden></ul>
    </div>'''

# For root-level pages
I18N_SCRIPT_ROOT = '<script src="i18n/i18n.js"></script>'
# For country subdirectory pages
I18N_SCRIPT_SUB = '<script src="../i18n/i18n.js"></script>'

NAV_REPLACEMENTS = {
    '<a href="about.html">Foundation</a>': '<a href="about.html" data-i18n="nav.foundation">Foundation</a>',
    '<a href="about.html" aria-current="page">Foundation</a>': '<a href="about.html" aria-current="page" data-i18n="nav.foundation">Foundation</a>',
    '<a href="directory.html">Directory</a>': '<a href="directory.html" data-i18n="nav.directory">Directory</a>',
    '<a href="directory.html" aria-current="page">Directory</a>': '<a href="directory.html" aria-current="page" data-i18n="nav.directory">Directory</a>',
    '<a href="map.html">Atlas</a>': '<a href="map.html" data-i18n="nav.atlas">Atlas</a>',
    '<a href="map.html" aria-current="page">Atlas</a>': '<a href="map.html" aria-current="page" data-i18n="nav.atlas">Atlas</a>',
    '<a href="analytics.html">Analytics</a>': '<a href="analytics.html" data-i18n="nav.analytics">Analytics</a>',
    '<a href="analytics.html" aria-current="page">Analytics</a>': '<a href="analytics.html" aria-current="page" data-i18n="nav.analytics">Analytics</a>',
    '<a href="news.html">Dispatch</a>': '<a href="news.html" data-i18n="nav.dispatch">Dispatch</a>',
    '<a href="news.html" aria-current="page">Dispatch</a>': '<a href="news.html" aria-current="page" data-i18n="nav.dispatch">Dispatch</a>',
    '<a href="mailto:hello@esrf.net" class="mast-cta">Request listing</a>': '<a href="mailto:hello@esrf.net" class="mast-cta" data-i18n="nav.request_listing">Request listing</a>',
    '<a href="#join" class="mast-cta">Request listing</a>': '<a href="#join" class="mast-cta" data-i18n="nav.request_listing">Request listing</a>',
}

# Files to patch (root-level)
ROOT_FILES = [
    'index.html', 'about.html', 'map.html', 'analytics.html',
    'news.html', 'privacy.html', 'terms.html'
]

def patch_file(filepath, i18n_script, is_subdir=False):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Skip if already patched
    if 'lang-switch' in content:
        print(f'  [skip] {filepath} already has lang-switch')
        return

    # 1. Add data-i18n to nav links
    for old, new in NAV_REPLACEMENTS.items():
        content = content.replace(old, new)

    # 2. Add lang-switch after the closing </div> of mast-nav
    # Pattern: find </div>\n  </div> at end of mast-nav area
    # We look for the pattern: mast-nav id block closing + mast-inner closing
    # Insert lang-switch before the closing </div> of mast-inner
    
    # Find the mast-nav div and add lang-switch after it
    # Pattern: </div>\n  </div>\n</nav>
    mast_pattern = r'(    </div>\n  </div>\n</nav>)'
    if re.search(mast_pattern, content):
        content = re.sub(
            mast_pattern,
            LANG_SWITCH + '\n  </div>\n</nav>',
            content,
            count=1
        )
    
    # 3. Add i18n.js before app.js or before </body>
    if i18n_script not in content:
        if '<script src="app.js"></script>' in content:
            content = content.replace(
                '<script src="app.js"></script>',
                f'{i18n_script}\n<script src="app.js"></script>'
            )
        elif '<script src="../app.js"></script>' in content:
            content = content.replace(
                '<script src="../app.js"></script>',
                f'{i18n_script}\n<script src="../app.js"></script>'
            )
        else:
            content = content.replace('</body>', f'{i18n_script}\n</body>')

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  [ok] {filepath}')

os.chdir('/home/user/workspace/esrf')

print('Patching root files...')
for fname in ROOT_FILES:
    if os.path.exists(fname):
        patch_file(fname, I18N_SCRIPT_ROOT)

print('Patching countries/index.html...')
countries_index = 'countries/index.html'
if os.path.exists(countries_index):
    with open(countries_index, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # For countries page the paths are relative: ../about.html etc
    # Fix nav links for subdirectory  
    sub_nav = {
        '<a href="../about.html">Foundation</a>': '<a href="../about.html" data-i18n="nav.foundation">Foundation</a>',
        '<a href="../directory.html">Directory</a>': '<a href="../directory.html" data-i18n="nav.directory">Directory</a>',
        '<a href="../map.html">Atlas</a>': '<a href="../map.html" data-i18n="nav.atlas">Atlas</a>',
        '<a href="../analytics.html">Analytics</a>': '<a href="../analytics.html" data-i18n="nav.analytics">Analytics</a>',
        '<a href="../news.html">Dispatch</a>': '<a href="../news.html" data-i18n="nav.dispatch">Dispatch</a>',
        '<a href="mailto:hello@esrf.net" class="mast-cta">Request listing</a>': '<a href="mailto:hello@esrf.net" class="mast-cta" data-i18n="nav.request_listing">Request listing</a>',
    }
    for old, new in sub_nav.items():
        content = content.replace(old, new)
    
    if 'lang-switch' not in content:
        mast_pattern = r'(    </div>\n  </div>\n</nav>)'
        if re.search(mast_pattern, content):
            content = re.sub(
                mast_pattern,
                LANG_SWITCH + '\n  </div>\n</nav>',
                content,
                count=1
            )
        
        # Add i18n script  
        if I18N_SCRIPT_SUB not in content:
            if '<script src="../app.js"></script>' in content:
                content = content.replace(
                    '<script src="../app.js"></script>',
                    f'{I18N_SCRIPT_SUB}\n<script src="../app.js"></script>'
                )
            else:
                content = content.replace('</body>', f'{I18N_SCRIPT_SUB}\n</body>')
    
    with open(countries_index, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'  [ok] {countries_index}')

print('Done!')
