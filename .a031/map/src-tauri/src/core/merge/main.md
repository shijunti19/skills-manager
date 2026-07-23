---
type: folder
node_type: file
grid_w: 20
grid_h: 16
canvas_points: "[[0.5,0,1,0,-1],[0.5,1,1,0,1],[0,0.5,1,-1,0],[1,0.5,1,1,0]]"
---
# merge
## 描述
**apply.rs**：! Atomic application of the object merge (design §5) plus the surrounding
! pipeline: preconditions, old-client detection (§6), fast-forward guard,
! crash-safe ref choreography and the startup recovery protocol.

**decision.rs**：! Pure three-way decision (design §3): object-level table, component-level
! merge for skills, whole-file newest-wins for scenarios / memberships /
! residual paths, and the viewpoint-independent path-collision pass.
!
! Everything here is a pure function of the three snapshots plus the
! declared-pending pin set and the per-side last-touch info — no repository
! access — so both devices merging the same pair of commits compute the
! same plan (§10 convergence).

**integration_tests.rs**：! Two-repository integration tests for the object merge engine (design
! §10): compose/convergence, true conflicts with cross-device pending,
! resolutions, ff guard, crash recovery, old-client detection and the
! legacy fallback.
!
! Every test owns the global central-repo override (serialized by the
! test lock) and switches it between "device A" and "device B" before
! operating as that device.

**mod.rs**：! Object-level three-way merge of the skills library (merge-engine design,
! `docs/merge-engine-design.md`). Phase 3d-α introduced protocol markers on
! every app commit plus the engine itself; 3d-β makes the object merge the
! default for manual sync, with `merge_engine=system` as the opt-out escape
! hatch back to the legacy line-level git merge.

**pending.rs**：! Pending-conflict machinery (design §4, §11-4/5): the source of truth for
! "needs attention" is the commit history's `Skills-Manager-Conflicts:` /
! `Skills-Manager-Resolved:` trailers, replayed in topological order. The
! hidden refs under `refs/skills-manager/` only pin theirs-side objects
! against GC and record where the theirs version lives; the SQLite table is
! a rebuildable UI projection.

**protocol.rs**：! Merge protocol markers (merge-engine design §6).
!
! Every commit the app creates carries a `Skills-Manager-Protocol: 2`
! trailer and guarantees `.skills-manager/protocol.json` exists in the tree
! (sticky — restoring a pre-protocol snapshot self-heals on the next
! commit). Together these let the object-merge engine detect writes made by
! clients that do not understand the pairing rules: a commit whose tree has
! `protocol.json` but whose message lacks the trailer was written by an old
! client.

**resolve.rs**：! Conflict resolution actions (design §4): keep local / use remote / keep
! both. Each runs inside the repo lock, takes a user-visible safety
! snapshot first, records the resolution with a `Skills-Manager-Resolved:`
! trailer (the cross-device close signal), then drops the pinned ref and
! projection row.

**snapshot.rs**：! Read one commit's tree into the logical objects the merge operates on
! (design §1/§2): skills (metadata + content-tree fingerprint), scenarios,
! memberships, residual files, and the schema/protocol markers.

**treebuild.rs**：! Recursive tree construction (design §5): apply a set of path-addressed
! edits to a base tree, rebuilding the ancestor chain bottom-up with
! per-level `TreeBuilder`s. `TreeUpdateBuilder` is deliberately not used —
! its handling of remove-then-upsert on one path and of blob↔tree type
! changes is incomplete; type changes are handled explicitly here by
! removing the old entry before inserting the new one.
!
! Callers express "replace whatever is at this path" by inserting removes
! first and letting puts overwrite them in the flat edit map. A nested edit
! below a removed path builds that directory from scratch (the removed
! subtree's former siblings do not leak through).

**validate.rs**：! Merged-tree validation (design §7). Pure checking, deliberately
! independent of (and stricter than) reindex: any violation aborts the
! whole merge with zero changes. Self-healing corrections (orphan drops)
! happen earlier, as tree-build inputs — never here.


## 父节点
- [← 返回](@/map/src-tauri/src/core/main.md)

## 子文件
- [apply.rs](${ProjectRoot}/src-tauri/src/core/merge/apply.rs)
- [decision.rs](${ProjectRoot}/src-tauri/src/core/merge/decision.rs)
- [integration_tests.rs](${ProjectRoot}/src-tauri/src/core/merge/integration_tests.rs)
- [mod.rs](${ProjectRoot}/src-tauri/src/core/merge/mod.rs)
- [pending.rs](${ProjectRoot}/src-tauri/src/core/merge/pending.rs)
- [protocol.rs](${ProjectRoot}/src-tauri/src/core/merge/protocol.rs)
- [resolve.rs](${ProjectRoot}/src-tauri/src/core/merge/resolve.rs)
- [snapshot.rs](${ProjectRoot}/src-tauri/src/core/merge/snapshot.rs)
- [treebuild.rs](${ProjectRoot}/src-tauri/src/core/merge/treebuild.rs)
- [validate.rs](${ProjectRoot}/src-tauri/src/core/merge/validate.rs)

## 子文件描述
- [apply.rs]
  ! Atomic application of the object merge (design §5) plus the surrounding
  ! pipeline: preconditions, old-client detection (§6), fast-forward guard,
  ! crash-safe ref choreography and the startup recovery protocol.
- [decision.rs]
  ! Pure three-way decision (design §3): object-level table, component-level
  ! merge for skills, whole-file newest-wins for scenarios / memberships /
  ! residual paths, and the viewpoint-independent path-collision pass.
  !
  ! Everything here is a pure function of the three snapshots plus the
  ! declared-pending pin set and the per-side last-touch info — no repository
  ! access — so both devices merging the same pair of commits compute the
  ! same plan (§10 convergence).
- [integration_tests.rs]
  ! Two-repository integration tests for the object merge engine (design
  ! §10): compose/convergence, true conflicts with cross-device pending,
  ! resolutions, ff guard, crash recovery, old-client detection and the
  ! legacy fallback.
  !
  ! Every test owns the global central-repo override (serialized by the
  ! test lock) and switches it between "device A" and "device B" before
  ! operating as that device.
- [mod.rs]
  ! Object-level three-way merge of the skills library (merge-engine design,
  ! `docs/merge-engine-design.md`). Phase 3d-α introduced protocol markers on
  ! every app commit plus the engine itself; 3d-β makes the object merge the
  ! default for manual sync, with `merge_engine=system` as the opt-out escape
  ! hatch back to the legacy line-level git merge.
- [pending.rs]
  ! Pending-conflict machinery (design §4, §11-4/5): the source of truth for
  ! "needs attention" is the commit history's `Skills-Manager-Conflicts:` /
  ! `Skills-Manager-Resolved:` trailers, replayed in topological order. The
  ! hidden refs under `refs/skills-manager/` only pin theirs-side objects
  ! against GC and record where the theirs version lives; the SQLite table is
  ! a rebuildable UI projection.
- [protocol.rs]
  ! Merge protocol markers (merge-engine design §6).
  !
  ! Every commit the app creates carries a `Skills-Manager-Protocol: 2`
  ! trailer and guarantees `.skills-manager/protocol.json` exists in the tree
  ! (sticky — restoring a pre-protocol snapshot self-heals on the next
  ! commit). Together these let the object-merge engine detect writes made by
  ! clients that do not understand the pairing rules: a commit whose tree has
  ! `protocol.json` but whose message lacks the trailer was written by an old
  ! client.
- [resolve.rs]
  ! Conflict resolution actions (design §4): keep local / use remote / keep
  ! both. Each runs inside the repo lock, takes a user-visible safety
  ! snapshot first, records the resolution with a `Skills-Manager-Resolved:`
  ! trailer (the cross-device close signal), then drops the pinned ref and
  ! projection row.
- [snapshot.rs]
  ! Read one commit's tree into the logical objects the merge operates on
  ! (design §1/§2): skills (metadata + content-tree fingerprint), scenarios,
  ! memberships, residual files, and the schema/protocol markers.
- [treebuild.rs]
  ! Recursive tree construction (design §5): apply a set of path-addressed
  ! edits to a base tree, rebuilding the ancestor chain bottom-up with
  ! per-level `TreeBuilder`s. `TreeUpdateBuilder` is deliberately not used —
  ! its handling of remove-then-upsert on one path and of blob↔tree type
  ! changes is incomplete; type changes are handled explicitly here by
  ! removing the old entry before inserting the new one.
  !
  ! Callers express "replace whatever is at this path" by inserting removes
  ! first and letting puts overwrite them in the flat edit map. A nested edit
  ! below a removed path builds that directory from scratch (the removed
  ! subtree's former siblings do not leak through).
- [validate.rs]
  ! Merged-tree validation (design §7). Pure checking, deliberately
  ! independent of (and stricter than) reindex: any violation aborts the
  ! whole merge with zero changes. Self-healing corrections (orphan drops)
  ! happen earlier, as tree-build inputs — never here.

## 实际路径
- X:\xiaolu\ai\plugin\skills-manager/src-tauri/src/core/merge
