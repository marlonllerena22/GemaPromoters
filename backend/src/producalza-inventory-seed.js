const MODEL_SIZES = ['34', '35', '36', '37', '38', '39', '40', '41', '42'];
const PLANT_SIZES = ['34', '35', '36', '37', '38', '39'];
const CHILD_PLANT_SIZES = ['27', '28', '29', '30', '31', '32'];
const TACO_SIZES = ['34-35', '36-37', '38-39'];

const rows = [
  ['Tacos', '7 1/2 082', '', TACO_SIZES, [28, 18, 2]],
  ['Tacos', '5 1/2 082', '', TACO_SIZES, [2, 4, 1]],
  ['Tacos', '7 1/2 090', '', TACO_SIZES, [6, 3, 1]],
  ['Tacos', '5 1/2 090', '', TACO_SIZES, [24, 20, 18]],
  ['Tacos', 'Texano 104 5 1/2', '', TACO_SIZES, [16, 11, 11]],
  ['Tacos', '5 1/2 099', 'Negro', TACO_SIZES, [27, 31, 18]],
  ['Tacos', '5 1/2 099', 'Cafe', TACO_SIZES, [24, 15, 16]],
  ['Tacos', '7 1/2 099', 'Negro', TACO_SIZES, [18, 15, 3]],
  ['Tacos', '7 1/2 099', 'Cafe', TACO_SIZES, [14, 17, 14]],
  ['Tacos', '082 7 1/2', 'Negro rayas', TACO_SIZES, [23, 19, 11]],
  ['Tacos', '082 7 1/2', 'Almendra rayas', TACO_SIZES, [23, 17, 11]],
  ['Tacos', '092 ps2', 'Negro Reyes', TACO_SIZES, [22, 29, 0]],
  ['Tacos', '092 ps2', 'Almendra Reyes', TACO_SIZES, [29, 33, 0]],
  ['Tacos', '105 5 1/2', 'Negro', TACO_SIZES, [24, 24, 24]],
  ['Tacos', '105 5 1/2', 'Cafe', TACO_SIZES, [24, 24, 24]],
  ['Tacos', '105 5 1/2', 'Negro rayas', TACO_SIZES, [20, 17, 11]],

  ['Suelas', 'S 061 texano', 'Negro', ['34', '35', '36', '37', '38', '39', '40'], [9, 7, 0, 4, 5, 9, 0]],
  ['Suelas', 'S 061 texano', 'Grepe', ['34', '35', '36', '37', '38', '39', '40'], [4, 1, 0, 0, 0, 6, 0]],
  ['Suelas', 'S 076', 'Negro', ['34', '35', '36', '37', '38', '39', '40'], [5, 10, 16, 15, 11, 5, 0]],
  ['Suelas', 'S 076', 'Grepe', ['34', '35', '36', '37', '38', '39', '40'], [5, 10, 18, 15, 10, 5, 0]],
  ['Suelas', 'S 070', 'Negro', ['Sin talla'], [50]],
  ['Suelas', 'S 070', 'Cafe', ['Sin talla'], [25]],

  ['Plantas', 'Lucinas', 'Cafe', PLANT_SIZES, [2, 1, 3, 2, 1, 1]],
  ['Plantas', 'Lucinas', 'Negro', PLANT_SIZES, [2, 1, 1, 0, 1, 2]],
  ['Plantas', 'Miel 5855', 'Negro', PLANT_SIZES, [2, 2, 1, 2, 2, 2]],
  ['Plantas', 'Issa', 'Cafe', PLANT_SIZES, [1, 1, 1, 1, 1, 0]],

  ['Plantas niñas', 'Mariana niña', 'Cafe', CHILD_PLANT_SIZES, [6, 8, 8, 0, 7, 4]],
  ['Plantas niñas', 'Mariana niña', 'Negro', CHILD_PLANT_SIZES, [11, 8, 4, 0, 3, 0]],
  ['Plantas niñas', 'Mariana niña', 'Blanco', CHILD_PLANT_SIZES, [8, 9, 9, 8, 11, 32]],

  ['Modelos', 'Breci', 'Negro', MODEL_SIZES, [8, 13, 13, 13, 2, 0, 0, 0, 0]],
  ['Modelos', 'Breci', 'Cafe', MODEL_SIZES, [16, 15, 18, 14, 16, 0, 0, 0, 0]],
  ['Modelos', 'Breci', 'Grepe', MODEL_SIZES, [19, 15, 10, 11, 15, 0, 0, 0, 0]],
  ['Modelos', 'Titania', 'Grepe', MODEL_SIZES, [5, 8, 26, 27, 18, 2, 0, 0, 0]],
  ['Modelos', 'Titania', 'Cafe', MODEL_SIZES, [10, 19, 32, 28, 18, 5, 0, 0, 0]],
  ['Modelos', 'Titania', 'Negro', MODEL_SIZES, [5, 16, 34, 32, 23, 3, 0, 0, 0]],
  ['Modelos', 'Rosalia', 'Negro', MODEL_SIZES, [4, 4, 5, 4, 3, 2, 0, 0, 0]],
  ['Modelos', 'Rosalia', 'Cafe', MODEL_SIZES, [6, 8, 5, 5, 5, 2, 0, 0, 0]],
  ['Modelos', 'Alejandra', 'Cafe', MODEL_SIZES, [3, 0, 4, 3, 4, 1, 0, 0, 0]],
  ['Modelos', 'Alejandra', 'Negro', MODEL_SIZES, [4, 5, 7, 1, 4, 3, 0, 0, 0]],
  ['Modelos', 'Adara', 'Negro', MODEL_SIZES, [4, 5, 3, 2, 1, 1, 0, 0, 0]],
  ['Modelos', 'Adara', 'Cafe', MODEL_SIZES, [4, 5, 4, 4, 4, 2, 0, 0, 0]],
  ['Modelos', 'Michelle', '', MODEL_SIZES, [0, 15, 12, 12, 4, 0, 0, 0, 0]],
  ['Modelos', 'Francy', '', MODEL_SIZES, [7, 5, 4, 6, 6, 8, 0, 0, 0]],
  ['Modelos', 'Elena', '', MODEL_SIZES, [6, 9, 8, 5, 3, 2, 0, 0, 0]],
  ['Modelos', 'Dakota', 'Negro', MODEL_SIZES, [6, 1, 3, 2, 1, 3, 0, 0, 0]],
  ['Modelos', 'Dakota', 'Cafe', MODEL_SIZES, [2, 3, 3, 4, 1, 1, 0, 0, 0]],
  ['Modelos', 'Queen', 'Beige', MODEL_SIZES, [1, 0, 3, 11, 4, 0, 0, 0, 0]],
  ['Modelos', 'Magui', 'Cafe', MODEL_SIZES, [2, 0, 0, 1, 2, 0, 0, 0, 0]],
  ['Modelos', 'Magui', 'Grepe', MODEL_SIZES, [0, 0, 0, 4, 0, 0, 0, 0, 0]],
  ['Modelos', 'Magui', 'Negro', MODEL_SIZES, [2, 0, 0, 1, 0, 1, 0, 0, 0]],
  ['Modelos', 'Karen', 'Negro', MODEL_SIZES, [0, 0, 0, 0, 0, 2, 0, 0, 0]],
  ['Modelos', 'Karen', 'Cafe', MODEL_SIZES, [4, 3, 5, 4, 5, 5, 0, 0, 0]],
  ['Modelos', 'Sharit', '', MODEL_SIZES, [0, 0, 0, 2, 1, 7, 0, 0, 0]],
  ['Modelos', 'Sol', 'Negro', MODEL_SIZES, [0, 0, 0, 4, 0, 0, 0, 0, 0]],
  ['Modelos', 'Maria Jose', 'Negro', MODEL_SIZES, [4, 0, 1, 0, 0, 0, 0, 0, 0]],
  ['Modelos', 'Maria Jose', 'Cafe', MODEL_SIZES, [4, 0, 0, 0, 1, 0, 0, 0, 0]],
  ['Modelos', 'Manuela', 'Cafe', MODEL_SIZES, [0, 2, 0, 0, 0, 0, 0, 0, 0]],
  ['Modelos', 'Manuela', 'Negro', MODEL_SIZES, [0, 2, 0, 0, 0, 0, 0, 0, 0]],
  ['Modelos', 'Ambre', 'Cafe', MODEL_SIZES, [1, 0, 0, 0, 0, 2, 0, 0, 0]],
  ['Modelos', 'Brenda', 'Cafe', MODEL_SIZES, [0, 0, 2, 0, 1, 2, 0, 0, 0]],
  ['Modelos', 'Brenda', 'Negro', MODEL_SIZES, [0, 0, 0, 1, 0, 1, 0, 0, 0]],
  ['Modelos', 'Nardo', 'Cafe', MODEL_SIZES, [0, 0, 0, 0, 3, 1, 0, 0, 0]],
  ['Modelos', 'Brisa', 'Beige', MODEL_SIZES, [0, 0, 2, 4, 0, 1, 0, 0, 0]],
  ['Modelos', 'Analia', 'Negro', MODEL_SIZES, [0, 0, 0, 1, 0, 1, 0, 0, 0]],
  ['Modelos', 'Analia', 'Blanco', MODEL_SIZES, [0, 0, 1, 0, 0, 0, 0, 0, 0]],
  ['Modelos', 'Analia', 'Cafe', MODEL_SIZES, [0, 0, 0, 1, 1, 0, 0, 0, 0]],
  ['Modelos', 'Princes', 'Beige', MODEL_SIZES, [0, 0, 4, 14, 12, 3, 0, 0, 1]],
  ['Modelos', 'Princes', 'Grepe', MODEL_SIZES, [0, 0, 10, 7, 0, 0, 0, 0, 0]],
  ['Modelos', 'Princes', 'Negro', MODEL_SIZES, [3, 0, 0, 0, 6, 2, 0, 0, 0]],
  ['Modelos', 'Tr 255', 'Negro', MODEL_SIZES, [0, 1, 6, 0, 0, 0, 0, 0, 0]],
  ['Modelos', 'Penny', 'Cafe', MODEL_SIZES, [0, 0, 0, 6, 0, 2, 0, 0, 0]],
  ['Modelos', 'Penny', 'Negro', MODEL_SIZES, [2, 1, 0, 0, 0, 0, 0, 0, 0]]
];

export const PRODUCALZA_INITIAL_INVENTORY = rows.map(([category, name, color, labels, quantities], index) => ({
  sourceKey: `inventory-pdf-2026-${index + 1}`,
  code: `BOD-${String(index + 1).padStart(4, '0')}`,
  category,
  name,
  color,
  unit: 'unidades',
  variants: labels.map((label, position) => ({
    label,
    quantity: Number(quantities[position] || 0),
    position
  }))
}));

export const PRODUCALZA_INITIAL_INVENTORY_TOTAL = PRODUCALZA_INITIAL_INVENTORY.reduce(
  (total, item) => total + item.variants.reduce((subtotal, variant) => subtotal + variant.quantity, 0),
  0
);
