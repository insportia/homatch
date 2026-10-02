// Why an edit was refused, in the customer's words (translation keys), shared by the editor and the home view.

export const REJECTION_KEY: Record<string, string> = {
  PLACEMENT_BLOCKED: 'ds_reject_op_placement',
  OBJECT_LOCKED: 'ds_reject_op_kept',
  CATEGORY_LOCKED: 'ds_reject_op_category_locked',
  UNKNOWN_ASSET: 'ds_reject_op_asset',
  INACTIVE_ASSET: 'ds_reject_op_asset',
  MATERIAL_NOT_FOR_SURFACE: 'ds_reject_op_material',
  TOO_MANY_OBJECTS: 'ds_reject_op_too_many',
  NOT_ALLOWED_FOR_ASSET: 'ds_reject_op_not_allowed',
};
