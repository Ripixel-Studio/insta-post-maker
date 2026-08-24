import { beforeEach, describe, expect, it } from 'vitest';
import { editorActions, EDITOR_TOOLS, runAction, getTool } from './actions';
import { useEditor } from './store';
import { DEFAULT_PRESET } from './presets';
import { emptyDesign } from './store';

/** Reset the store to a clean single-page design before each test. */
beforeEach(() => {
  useEditor.getState().loadDesign(emptyDesign(DEFAULT_PRESET));
});

describe('canvas', () => {
  it('newCanvas resets to a fresh single-page design at a preset', () => {
    editorActions.addText('leftover');
    editorActions.newCanvas({ preset: 'square', background: '#000000' });
    const { design } = editorActions.getState();
    expect(design.width).toBe(1080);
    expect(design.height).toBe(1080);
    expect(design.pages).toHaveLength(1);
    expect(design.pages[0].layers).toHaveLength(0);
    expect(design.pages[0].background).toBe('#000000');
  });

  it('newCanvas honours explicit size over the preset', () => {
    editorActions.newCanvas({ preset: 'square', width: 400, height: 900 });
    const { design } = editorActions.getState();
    expect(design.width).toBe(400);
    expect(design.height).toBe(900);
  });

  it('rejects an unknown preset', () => {
    expect(() => editorActions.newCanvas({ preset: 'nope' })).toThrow(/Unknown preset/);
    expect(() => editorActions.setPreset('nope')).toThrow(/Unknown preset/);
  });

  it('setPreset keeps existing layers', () => {
    const id = editorActions.addText('keep me');
    editorActions.setPreset('portrait');
    const { design } = editorActions.getState();
    expect(design.height).toBe(1350);
    expect(design.pages[0].layers.map((l) => l.id)).toContain(id);
  });

  it('setBackground updates the active page', () => {
    editorActions.setBackground('#123456');
    expect(editorActions.getState().design.pages[0].background).toBe('#123456');
  });
});

describe('images', () => {
  it('addImage adds a centred image layer and returns its id', () => {
    const id = editorActions.addImage('asset_x');
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id);
    expect(layer?.type).toBe('image');
    expect((layer as { assetId: string }).assetId).toBe('asset_x');
  });

  it('addImage applies position/size options', () => {
    const id = editorActions.addImage('asset_x', { x: 10, y: 20, width: 100, height: 200 });
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)!;
    expect([layer.x, layer.y, layer.width, layer.height]).toEqual([10, 20, 100, 200]);
  });

  it('placeImage moves a layer but leaves omitted fields intact', () => {
    const id = editorActions.addImage('asset_x', { x: 0, y: 0, width: 50, height: 50 });
    editorActions.placeImage(id, { x: 300 });
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)!;
    expect(layer.x).toBe(300);
    expect(layer.width).toBe(50);
  });

  it('cropImage and fitImageToCanvas set crop rects', () => {
    const id = editorActions.addImage('asset_x');
    editorActions.cropImage(id, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    let layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      crop?: { width: number };
    };
    expect(layer.crop?.width).toBeCloseTo(0.8);
    editorActions.fitImageToCanvas(id);
    layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      crop?: { width: number };
    };
    expect(layer.crop).toBeDefined();
  });

  it('adjustImage merges filters; applyFilterPreset replaces them', () => {
    const id = editorActions.addImage('asset_x');
    editorActions.adjustImage(id, { brightness: 0.5 });
    editorActions.adjustImage(id, { contrast: 20 });
    let layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      filters: { brightness: number; contrast: number; saturation: number };
    };
    expect(layer.filters.brightness).toBe(0.5);
    expect(layer.filters.contrast).toBe(20);
    editorActions.applyFilterPreset(id, 'mono');
    layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      filters: { brightness: number; contrast: number; saturation: number };
    };
    expect(layer.filters.saturation).toBe(-1);
    expect(layer.filters.brightness).toBe(0);
  });

  it('rejects image ops on a non-image layer', () => {
    const id = editorActions.addText('hi');
    expect(() => editorActions.cropImage(id, { x: 0, y: 0, width: 1, height: 1 })).toThrow(
      /not an image/,
    );
  });
});

describe('text', () => {
  it('addText returns an id and stores the content/colour', () => {
    const id = editorActions.addText('Hyrox Doubles', { fill: '#ff0000', fontFamily: 'Anton' });
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      type: string;
      text: string;
      fill: string;
      fontFamily: string;
    };
    expect(layer.type).toBe('text');
    expect(layer.text).toBe('Hyrox Doubles');
    expect(layer.fill).toBe('#ff0000');
    expect(layer.fontFamily).toBe('Anton');
  });

  it('styleText restyles an existing text layer', () => {
    const id = editorActions.addText('draft');
    editorActions.styleText(id, { text: 'final', fontSize: 88, align: 'center' });
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      text: string;
      fontSize: number;
      align: string;
    };
    expect(layer.text).toBe('final');
    expect(layer.fontSize).toBe(88);
    expect(layer.align).toBe('center');
  });

  it('setTextColor sets a solid fill', () => {
    const id = editorActions.addText('x');
    editorActions.setTextColor(id, '#00ff00');
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id)! as {
      fill: string;
      fillKind: string;
    };
    expect(layer.fill).toBe('#00ff00');
    expect(layer.fillKind).toBe('solid');
  });

  it('listFonts includes the built-in families', () => {
    expect(editorActions.listFonts()).toContain('Inter');
  });
});

describe('pages', () => {
  it('addPage / duplicatePage / removePage track the page count', () => {
    expect(editorActions.pageCount()).toBe(1);
    editorActions.addText('p1');
    editorActions.addPage();
    expect(editorActions.pageCount()).toBe(2);
    editorActions.duplicatePage();
    expect(editorActions.pageCount()).toBe(3);
    editorActions.removePage(2);
    expect(editorActions.pageCount()).toBe(2);
  });

  it('setActivePage rejects out-of-range indices', () => {
    expect(() => editorActions.setActivePage(5)).toThrow(/out of range/);
  });
});

describe('layout & collage', () => {
  it('applyLayout builds a collage with cells; cells can be filled and cleared', () => {
    editorActions.applyLayout('4');
    const ids = editorActions.collageCellIds();
    expect(ids).toHaveLength(4);
    editorActions.setCollageCellImage(ids[0], 'asset_a');
    const snap = editorActions.getSnapshot();
    expect(snap.pages[0].collage?.cells[0].filled).toBe(true);
    editorActions.clearCollage();
    expect(editorActions.collageCellIds()).toHaveLength(0);
  });

  it('rejects an unknown layout and an unknown cell', () => {
    expect(() => editorActions.applyLayout('nope')).toThrow(/Unknown layout/);
    expect(() => editorActions.setCollageCellImage('cell_missing', 'a')).toThrow(/No collage cell/);
  });
});

describe('tool registry', () => {
  it('every tool name is unique and describable', () => {
    const names = EDITOR_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of EDITOR_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.parameters.type).toBe('object');
    }
  });

  it('runAction dispatches a create-and-return-id tool', () => {
    const id = runAction('add_text', { text: 'via tool' });
    expect(typeof id).toBe('string');
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id);
    expect(layer).toBeDefined();
  });

  it('runAction runs a multi-step build the way a Copilot would', () => {
    runAction('new_canvas', { preset: 'square', background: '#0b0d10' });
    runAction('apply_layout', { layout: '2v' });
    const snap = runAction('get_snapshot') as ReturnType<typeof editorActions.getSnapshot>;
    const cellId = snap.pages[0].collage!.cells[0].id;
    runAction('set_collage_cell_image', { cellId, assetId: 'photo_1' });
    const after = editorActions.getSnapshot();
    expect(after.pages[0].collage?.cells[0].filled).toBe(true);
  });

  it('runAction throws on an unknown tool', () => {
    expect(() => runAction('teleport')).toThrow(/Unknown tool/);
  });

  it('runAction validates required arguments', () => {
    expect(() => runAction('set_preset', {})).toThrow(/missing required argument/);
  });

  it('getTool finds a tool by name', () => {
    expect(getTool('export_png')?.name).toBe('export_png');
    expect(getTool('nope')).toBeUndefined();
  });
});
