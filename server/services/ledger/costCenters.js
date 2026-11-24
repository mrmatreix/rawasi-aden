'use strict';
// The cost centre that belongs to a project (used on project cost lines posted by inventory and billing).
async function projectCostCenter(h, projectId) {
  if (!projectId) return null;
  const row = await h.get("SELECT id FROM cost_centers WHERE project_id = ? AND COALESCE(status, 'active') = 'active' ORDER BY id LIMIT 1", [projectId]);
  return row ? row.id : null;
}
module.exports = { projectCostCenter };
