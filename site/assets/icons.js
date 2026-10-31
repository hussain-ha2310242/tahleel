/* One stroke icon set (16px grid). Each name has one meaning. */
(function () {
  var P = {
    check: '<path d="m3.5 8.5 3 3 6-7"/>',
    pencil: '<path d="M10.5 2.5l3 3L6 13H3v-3z"/>',
    undo: '<path d="M6 4 3 7l3 3"/><path d="M3 7h7a3 3 0 0 1 0 6H8"/>',
    refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5v3h-3"/>',
    send: '<path d="M2.5 8 13.5 3 10.5 13.5 8 9z"/>',
    trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
    file: '<path d="M4 2h5l3 3v9H4z"/><path d="M6.5 8.5h3M6.5 11h3"/>',
    eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    download: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
    shield: '<path d="M8 2 13 3.5v4c0 3-2.2 5-5 6.5-2.8-1.5-5-3.5-5-6.5v-4z"/>',
    translate: '<path d="M2.5 4h7M6 2.5V4M4 4c.5 2.5 2.5 4.5 4.5 5"/><path d="M8.5 13.5 11 7l2.5 6.5M9.5 11.5h3"/>',
    chevronR: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
    chevronL: '<path d="m10 3.5-4.5 4.5 4.5 4.5"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    users: '<circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13.5c.6-2.4 2.3-3.8 4.5-3.8s3.9 1.4 4.5 3.8"/><path d="M10.5 3.2a2.5 2.5 0 0 1 0 4.8M12.5 10c1 .6 1.6 1.8 1.8 3.5"/>',
    building: '<path d="M3 14V3.5L8 2l5 1.5V14M3 14h10M6 6h1M9 6h1M6 9h1M9 9h1"/>',
    book: '<path d="M2.5 3.5c2-.8 3.8-.8 5.5.5v9c-1.7-1.3-3.5-1.3-5.5-.5zM13.5 3.5c-2-.8-3.8-.8-5.5.5v9c1.7-1.3 3.5-1.3 5.5-.5z"/>',
    mapPin: '<path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 0 0-9 0C3.5 9.8 8 14 8 14z"/><circle cx="8" cy="6.5" r="1.6"/>',
    sliders: '<path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6"/><circle cx="10" cy="4.5" r="1.5"/><circle cx="6" cy="11.5" r="1.5"/>',
    calendar: '<rect x="2.5" y="3.5" width="11" height="10" rx="1.5"/><path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5"/>',
    hash: '<path d="M6 2.5 5 13.5M11 2.5 10 13.5M2.5 6h11M2 10.5h11"/>',
    layers: '<path d="M8 2 14 5 8 8 2 5z"/><path d="M2 8.5 8 11.5 14 8.5M2 11.5 8 14.5 14 11.5"/>',
    flag: '<path d="M4 14V2.5M4 3h8l-2 2.5 2 2.5H4"/>',
    type: '<path d="M3 4V3h10v1M8 3v10M6 13h4"/>',
    list: '<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.8" cy="4" r=".6"/><circle cx="2.8" cy="8" r=".6"/><circle cx="2.8" cy="12" r=".6"/>',
    spark: '<path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2"/>',
    grid: '<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    bolt: '<path d="M9 2 4 9h4l-1 5 5-7H8z"/>',
    tick2: '<path d="m2.5 8.5 3.5 3.5L13.5 4"/>',
    arrowUp: '<path d="M8 13V3.5M4 7.5 8 3.5l4 4"/>',
    arrowR: '<path d="M3 8h9.5M8.5 4l4 4-4 4"/>'
  };
  function ic(name, cls) {
    var body = P[name];
    if (!body) return '';
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
  }
  window.TI = { ic: ic, names: Object.keys(P) };
})();
