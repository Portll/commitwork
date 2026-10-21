// Renders roadmap cards as indented HTML (bin/web-roadmap.mjs renderCards).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCards } from '../web-roadmap.mjs';

test('renders a single card with no items and no work', () => {
  const cards = [
    {
      title: 'Alpha',
      status: 'in progress',
      sub: 'First release',
      items: [],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Alpha<span class="pill live">in progress</span></h3>',
    '      <p class="sub">First release</p>',
    '      <ul class="feats">',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with one item that has no optional fields', () => {
  const cards = [
    {
      title: 'Beta',
      status: 'planned',
      sub: 'Second release',
      items: [
        {
          name: 'Feature A',
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Beta<span class="pill plan">planned</span></h3>',
    '      <p class="sub">Second release</p>',
    '      <ul class="feats">',
    '        <li><b>Feature A</b></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has a lead and ben but no fact', () => {
  const cards = [
    {
      title: 'Gamma',
      status: 'started',
      sub: 'Third release',
      items: [
        {
          lead: 'Custom Lead',
          ben: 'Benefit X',
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Gamma<span class="pill part">started</span></h3>',
    '      <p class="sub">Third release</p>',
    '      <ul class="feats">',
    '        <li>Custom Lead: <span class="ben">Benefit X</span></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has ben and fact', () => {
  const cards = [
    {
      title: 'Delta',
      status: 'released',
      sub: 'Fourth release',
      items: [
        {
          name: 'Feature B',
          ben: 'Benefit Y',
          fact: 'Fact Z',
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Delta<span class="pill live">released</span></h3>',
    '      <p class="sub">Fourth release</p>',
    '      <ul class="feats">',
    '        <li><b>Feature B</b>: <span class="ben">Benefit Y</span> Fact Z</li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has sub items', () => {
  const cards = [
    {
      title: 'Epsilon',
      status: 'done',
      sub: 'Fifth release',
      items: [
        {
          name: 'Feature C',
          sub: ['Sub 1', 'Sub 2'],
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Epsilon<span class="pill live">done</span></h3>',
    '      <p class="sub">Fifth release</p>',
    '      <ul class="feats">',
    '        <li><b>Feature C</b><ul class="sub"><li>Sub 1</li><li>Sub 2</li></ul></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has note and limit', () => {
  const cards = [
    {
      title: 'Zeta',
      status: 'on main',
      sub: 'Sixth release',
      items: [
        {
          name: 'Feature D',
          note: 'Some note',
          limit: 'Some limit',
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Zeta<span class="pill live">on main</span></h3>',
    '      <p class="sub">Sixth release</p>',
    '      <ul class="feats">',
    '        <li><b>Feature D</b><span class="limit">Some note <b>Limit:</b> Some limit</span></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has a pill', () => {
  const cards = [
    {
      title: 'Eta',
      status: 'shipped',
      sub: 'Seventh release',
      items: [
        {
          name: 'Feature E',
          pill: 'in progress',
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Eta<span class="pill live">shipped</span></h3>',
    '      <p class="sub">Seventh release</p>',
    '      <ul class="feats">',
    '        <li><b>Feature E</b><span class="pill live">in progress</span></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has added flag', () => {
  const cards = [
    {
      title: 'Theta',
      status: 'decision',
      sub: 'Eighth release',
      items: [
        {
          name: 'Feature F',
          added: true,
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Theta<span class="pill sev">decision</span></h3>',
    '      <p class="sub">Eighth release</p>',
    '      <ul class="feats">',
    '        <li><b>Feature F</b><span class="pill add">additional</span></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders a card with an item that has work entries', () => {
  const cards = [
    {
      title: 'Iota',
      status: 'in progress',
      sub: 'Ninth release',
      items: [
        {
          name: 'Feature G',
          work: [
            { date: '2024-01-01', what: 'Did something' },
            { date: '2024-01-02', what: 'Did something else' },
          ],
        },
      ],
    },
  ];
  const expected = [
    '    <div class="card">',
    '      <h3>Iota<span class="pill live">in progress</span></h3>',
    '      <p class="sub">Ninth release</p>',
    '      <p class="tally">0 of 1 feature done \u00b7 2 changes</p>',
    '      <ul class="feats">',
    '        <li><b>Feature G</b><details class="work"><summary>2 changes</summary><ul><li><time datetime="2024-01-01">2024-01-01</time> Did something</li><li><time datetime="2024-01-02">2024-01-02</time> Did something else</li></ul></details></li>',
    '      </ul>',
    '    </div>',
  ].join('\n');
  assert.equal(renderCards(cards), expected);
});

test('renders multiple cards with custom indent', () => {
  const cards = [
    {
      title: 'Card 1',
      status: 'planned',
      sub: 'Sub 1',
      items: [
        { name: 'Item 1' },
      ],
    },
    {
      title: 'Card 2',
      status: 'started',
      sub: 'Sub 2',
      items: [
        { name: 'Item 2' },
      ],
    },
  ];
  const expected = [
    '  <div class="card">',
    '    <h3>Card 1<span class="pill plan">planned</span></h3>',
    '    <p class="sub">Sub 1</p>',
    '    <ul class="feats">',
    '      <li><b>Item 1</b></li>',
    '    </ul>',
    '  </div>',
    '  <div class="card">',
    '    <h3>Card 2<span class="pill part">started</span></h3>',
    '    <p class="sub">Sub 2</p>',
    '    <ul class="feats">',
    '      <li><b>Item 2</b></li>',
    '    </ul>',
    '  </div>',
  ].join('\n');
  assert.equal(renderCards(cards, '  '), expected);
});
