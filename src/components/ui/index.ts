/**
 * The UI kit: one plate material, cut into every shape the product presses,
 * types into or switches between.
 *
 * The look lives in `src/index.css` as a handful of component classes (`.plate`,
 * `.btn`, `.chip`, `.field`, `.seg`, `.tab`); these components are the only
 * place those class names are written down, so a screen says what a control *is*
 * and never how it looks. Changing the material is then one file, not fifty.
 *
 * Documented in docs/design-system.md.
 */
export { default as Button, ButtonLink } from './Button';
export { default as Chip } from './Chip';
export { default as IconButton } from './IconButton';
export { default as Plate, PlateDivider, Cap } from './Plate';
export { default as Segmented, type SegmentedOption } from './Segmented';
export { default as Switch, type SwitchOption } from './Switch';
export { Field, Input, Kbd, Select, Textarea } from './Field';
export { cx } from './cx';
