# Plane Task Management Inventory

This file tracks Plane work item capabilities that should be preserved or rebuilt in Elio Planner without login, workspaces, or team permissions.

## Source Evidence

- Backend work item model: `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/issue.py`
- Related backend models:
  - `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/state.py`
  - `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/label.py`
  - `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/cycle.py`
  - `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/module.py`
  - `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/estimate.py`
  - `/Users/lixiangting/Elio/plane/apps/api/plane/db/models/view.py`
- Frontend services: `/Users/lixiangting/Elio/plane/apps/web/core/services/issue/`
- Frontend stores: `/Users/lixiangting/Elio/plane/apps/web/core/store/issue/`
- Frontend layouts:
  - `/Users/lixiangting/Elio/plane/apps/web/core/components/issues/issue-layouts/`
  - `/Users/lixiangting/Elio/plane/apps/web/core/components/base-layouts/`
- Drag/drop references:
  - `/Users/lixiangting/Elio/plane/apps/web/core/components/issues/issue-layouts/kanban/`
  - `/Users/lixiangting/Elio/plane/apps/web/core/components/issues/issue-layouts/list/`
  - `/Users/lixiangting/Elio/plane/packages/ui/src/sortable/`

## Capability Map

Implemented in Elio Lite now:

- Projects
- Work items with title, description, Definition of Done, custom state, labels, priority, start date, due date, planned date, time range, estimate, AI reason
- List view
- Kanban board by custom state
- Spreadsheet editable table view
- Timeline/Gantt-style monthly project view
- Today schedule table
- Detail drawer
- AI 助手 creates work items
- Markdown memory through `agent.md` and `data/memory`
- AI chat Markdown rendering
- Slash commands: `/compact`, view navigation, and `/new-thread`
- `@#id` task mention insertion, readable mention rendering, and AI prompt context expansion
- Board drag/drop across custom state columns
- Search, state filter, label filter, priority filter, and basic sort
- Per-project sequence numbers
- Parent tasks and subtasks
- Work item relations: blocked by, blocking, relates to, duplicate
- Comments and activity history
- Archive, deleted list, and restore
- Persistent drag ordering within and across kanban columns
- Calendar month view with drag-to-reschedule
- Calendar week view with drag-to-reschedule
- Timeline/Gantt bars with drag and resize date editing
- Saved local views with filters and display filters
- Project filter, planned date range filters, and work item grouping
- External links
- Local file attachments with download and soft delete
- Drafts, Inbox, and Triage personal workflow
- Bulk operations: state, label, planned date, promote, archive, delete
- Keyboard shortcuts and command palette
- Cycles and modules as optional personal planning containers
- Estimate points
- Cycle/module filters and grouping
- Bulk operations for cycle, module, and estimate point
- Edit/archive/restore UI for cycles and modules, plus edit UI for estimate points
- Manual order mode with drag/drop ordering inside Work Items lists
- Markdown edit/preview for task description, Definition of Done, AI reason, and comments
- Advanced boolean filter builder with AND/OR rules
- Display filters: sub-group by and show empty groups
- Label hierarchy
- Personal role/context field as the assignee-free execution context, including filtering, grouping, table editing, bulk update, and AI prompt context

Plane capabilities still to migrate:

- Rich WYSIWYG editor beyond Markdown edit/preview
- Rich filters beyond the current boolean builder: nested filter groups and saved filter presets if needed

## Migration Batches

1. Core personal work item model
   - Done: labels, label hierarchy, custom states, start date, due date, sequence key, personal role/context, archive and soft delete.
   - Keep SQLite and no login.

2. Plane-like views
   - Done: search bar, state/label/priority/project/date/cycle/module/role-context filters, basic order by, manual order, kanban custom state columns, persistent drag ordering in board and list layouts, group by including cycle/module/role-context, sub-group by, show empty groups, saved local views, boolean filter builder.
   - Remaining: nested filter groups if the flat AND/OR builder becomes too limiting.

3. Detail depth
   - Done: comments, activity log, sub-issues, relations, links, attachments, Markdown edit/preview for rich task text.
   - Remaining: WYSIWYG rich text editor if plain Markdown editing becomes too limiting.

4. Planning containers
   - Done: cycles, modules, estimate points, task assignment, filtering, grouping, bulk assignment, inline edit, and archive/restore for cycles/modules.
   - Remaining: richer project-scoped defaults.

5. Advanced layouts
   - Done: calendar month/week views with drag-to-reschedule, spreadsheet editable table view, monthly timeline/gantt-style project view with drag/resize date editing.
   - Remaining: none for the MVP Plane-like layouts.

6. Power-user controls
   - Done: bulk edit, keyboard shortcuts, command palette, richer slash commands, and strong `@` task references in AI context.
   - Remaining: broader command coverage if future workflows need it.
