# Blinding Workspace v0

**Status:** Design specification  
**Project:** blindstats  
**Scope:** First real application slice  
**Date:** 2026-09-01

---

## 1. Purpose

Blinding Workspace v0 is the first functional slice of blindstats.

Its purpose is to prove the scientific and technical core of the product before
introducing accounts, teams, databases, cloud storage, or multi-user permissions.

The v0 workflow is intentionally narrow:

> **Load a CSV → select one categorical variable → create a randomized neutral-label mapping → generate a blinded CSV → generate audit artifacts**

The implementation should establish the core concepts that later versions will
extend into the full blindstats workflow:

> **Analyst blinding → locked analysis → documented unblinding**

Blinding Workspace v0 is a local, single-user prototype. It is not yet a
multi-user security boundary and must not be presented as one.

---

## 2. Goals

Blinding Workspace v0 should demonstrate that blindstats can:

1. read a CSV dataset in the browser;
2. identify columns available for blinding;
3. allow the user to select one categorical column;
4. construct a randomized one-to-one mapping from original categories to neutral
   labels;
5. create a blinded derivative without changing unrelated data;
6. keep the true mapping separate from the blinded output;
7. compute artifact hashes;
8. produce a receipt that documents the transformation without revealing the
   mapping;
9. produce a private blinding key containing the mapping required for later
   unblinding; and
10. make all generated artifacts available for local download.

The first slice should answer important product-design questions before the
application gains persistence or multi-user infrastructure.

---

## 3. Non-goals

Blinding Workspace v0 will not include:

- user accounts;
- authentication;
- teams;
- study membership;
- role-based permissions;
- PostgreSQL or another application database;
- Neon;
- an ORM;
- server-side file upload;
- cloud object storage;
- persistent study records;
- controlled multi-user access;
- analysis-code execution;
- arbitrary R or Python execution;
- analysis locking;
- unblinding authorization;
- automated unblinding;
- AI-assisted rewriting;
- Excel, SPSS, SAS, Stata, or other file formats;
- continuous-variable transformations;
- simultaneous blinding of multiple variables;
- arbitrary transformation scripting;
- a general secure-file-transfer product; or
- claims that the application is suitable for sensitive, regulated,
  confidential, or client research data.

These features may be considered in later slices if the core workflow justifies
them.

---

## 4. Security boundary

### 4.1 Browser-only processing

For v0, research data should be processed entirely in the user's browser.

Conceptually:

```text
User's computer
     |
     |-- reads source CSV
     |-- parses data
     |-- generates randomized mapping
     |-- applies mapping
     |-- serializes blinded CSV
     |-- computes hashes
     |-- creates receipt
     |-- creates private blinding key
     `-- downloads artifacts

blindstats server
     |
     `-- does not receive the research dataset
```

This is a deliberate v0 design decision.

It allows the project to test the blinding engine without pretending that
secure server-side research-data storage has already been implemented.

### 4.2 Important limitation

Browser-only processing does **not** create role separation.

The person operating Blinding Workspace v0 has access to both:

- the original data; and
- the private blinding key.

Therefore v0 demonstrates the transformation and artifact model, not the final
multi-user blinding-security model.

The interface should clearly communicate this limitation.

### 4.3 No silent network transmission

The v0 implementation should not send uploaded dataset contents to blindstats
application routes, analytics services, third-party APIs, AI services, or other
remote endpoints.

This requirement applies to the dataset contents and generated blinding key.

---

## 5. Primary user workflow

The intended v0 user experience is:

1. Open Blinding Workspace.
2. Select a `.csv` file from the local computer.
3. blindstats reads and parses the file in the browser.
4. Display basic non-sensitive structural information needed for the workflow,
   such as:
   - row count;
   - column count;
   - column names; and
   - candidate columns.
5. Select one categorical variable to blind.
6. Review the distinct nonmissing category values in that variable.
7. Request creation of a blinding plan.
8. blindstats randomly assigns neutral labels to the observed categories.
9. Show a confirmation that a mapping was created without requiring the user to
   expose the mapping in the ordinary blinded-data preview.
10. Generate:
    - blinded CSV;
    - blinding receipt; and
    - private blinding key.
11. Allow the user to download all three artifacts separately.
12. Warn the user that the private blinding key must be stored separately from
    materials given to the blinded analyst.

---

## 6. Input contract

### 6.1 Supported format

v0 accepts:

```text
.csv
```

only.

Other formats should be rejected with a clear message rather than guessed or
silently converted.

### 6.2 Source artifact

The uploaded CSV is the source artifact.

The application must not mutate the parsed source representation while creating
the blinded derivative.

### 6.3 Minimum dataset requirements

The source CSV must:

- contain at least one column;
- contain a header row;
- contain at least one data row; and
- be parseable as a rectangular dataset under the chosen CSV parser's supported
  rules.

### 6.4 Candidate blinding column

The user selects exactly one column in v0.

The selected column must contain at least two distinct nonmissing values.

A column with zero or one distinct nonmissing value cannot produce a meaningful
category-label blinding operation and should be rejected.

### 6.5 Categorical interpretation

v0 does not attempt statistical type inference beyond what is needed for this
workflow.

A selected column is treated as categorical based on its distinct observed
serialized values.

A future version may introduce stronger type handling and validation.

---

## 7. Missing-value rules

Missingness must not be converted into a substantive category by default.

For the selected blinding column:

- missing values remain missing;
- missing values do not receive neutral group labels;
- missing values do not appear in the original-to-blinded mapping; and
- the number and positions of missing values must be preserved.

The CSV parser's representation of empty cells must be handled consistently
during parse and serialization.

The implementation must define and test the exact internal representation used
for missing CSV cells.

v0 should not attempt to interpret arbitrary strings such as `"NA"`, `"N/A"`,
`"."`, or `"missing"` as missing values unless the parser or a later explicit
configuration defines such behavior.

---

## 8. Blinding transformation

### 8.1 One-to-one mapping

Each distinct nonmissing original category receives exactly one neutral label.

The mapping must be bijective over the set of observed nonmissing categories.

For example:

```text
Original category     Neutral label
Treatment             Group_B
Control               Group_A
```

Repeated occurrences of the same original category must always receive the same
neutral label.

### 8.2 Neutral labels

The initial neutral-label convention is:

```text
Group_A
Group_B
Group_C
...
```

The label generator must support more than two categories.

The implementation should not assume that a treatment variable is binary.

A deterministic label-generation utility should create the required neutral
label set for the number of observed categories.

### 8.3 Random assignment

The association between original categories and neutral labels must be randomly
assigned.

The mapping must not be derived from:

- alphabetical category order;
- row order;
- frequency order;
- numeric magnitude;
- treatment/control semantics; or
- another predictable property of the original values.

Where available in the browser, randomness should use the Web Crypto API rather
than `Math.random()`.

A Fisher-Yates-style shuffle driven by cryptographically strong browser
randomness is an acceptable v0 approach.

### 8.4 Reproducibility

For v0, reproducibility is based on preservation of the explicit blinding key.

The application does not need to regenerate the same random mapping from a
public seed.

Instead:

1. the initial mapping is generated randomly;
2. the private key records the complete mapping;
3. applying that key to the same source artifact reproduces the same blinded
   transformation.

The public receipt must not contain enough information to reconstruct the
private mapping.

### 8.5 Source-column behavior

The initial implementation should replace the selected column's category values
in the blinded derivative while preserving the original column name.

Example:

```text
treatment
---------
Treatment
Control
Treatment
```

becomes:

```text
treatment
---------
Group_B
Group_A
Group_B
```

Renaming column headers can be considered as a separate future blinding
operation.

### 8.6 Unselected columns

Every unselected column must remain unchanged in content and row alignment.

No value in an unselected column should be altered as a side effect of
blinding.

### 8.7 Dataset dimensions

Blinding must not change:

- row count; or
- column count.

---

## 9. Output artifacts

v0 generates three downloadable artifacts.

### 9.1 Blinded CSV

Suggested filename:

```text
<source-base-name>_blinded.csv
```

The blinded CSV:

- contains the same rows as the source CSV;
- contains the same columns as the source CSV;
- preserves the selected column name;
- replaces only nonmissing values of the selected blinding column according to
  the private mapping; and
- contains no additional columns revealing the original category values.

### 9.2 Blinding receipt

Suggested filename:

```text
blinding-receipt.json
```

The receipt is intended to be shareable with the blinded-analysis materials.

It documents what transformation occurred without revealing the mapping.

A conceptual v0 schema is:

```json
{
  "schema_version": "0.1",
  "transformation_id": "uuid",
  "created_at": "ISO-8601 timestamp",
  "transformation_type": "categorical_label_permutation",
  "selected_column": "treatment",
  "category_count": 2,
  "row_count": 1000,
  "column_count": 12,
  "source_artifact": {
    "sha256": "..."
  },
  "blinded_artifact": {
    "sha256": "..."
  },
  "algorithm": {
    "neutral_label_scheme": "Group_<letters>",
    "mapping_assignment": "web_crypto_random_permutation"
  }
}
```

The exact final TypeScript schema may differ as implementation details are
refined.

The receipt must **not** contain:

- original category values;
- original-to-neutral mapping;
- a seed or secret that reconstructs the mapping;
- the full source dataset;
- the full blinded dataset; or
- other information that defeats the intended blinding.

### 9.3 Private blinding key

Suggested filename:

```text
blinding-key.json
```

The private key contains the information needed to interpret and later reverse
the blinding transformation.

A conceptual v0 schema is:

```json
{
  "schema_version": "0.1",
  "transformation_id": "same UUID as receipt",
  "created_at": "same transformation timestamp",
  "transformation_type": "categorical_label_permutation",
  "selected_column": "treatment",
  "source_artifact_sha256": "...",
  "blinded_artifact_sha256": "...",
  "mapping": [
    {
      "original": "Treatment",
      "blinded": "Group_B"
    },
    {
      "original": "Control",
      "blinded": "Group_A"
    }
  ]
}
```

The key is a private artifact.

The UI should clearly warn:

> Do not provide the blinding key to the blinded analyst.

Future multi-user blindstats versions should store and reveal this information
through role-based permissions rather than relying on manual file separation.

---

## 10. Artifact identity and hashing

### 10.1 Hash algorithm

v0 should use:

```text
SHA-256
```

for artifact integrity hashes.

The browser Web Crypto API is suitable for this operation.

### 10.2 Source hash

The source artifact hash should be computed from the original uploaded file
bytes, not from a parsed-and-reserialized approximation.

This allows the receipt to identify the exact source file supplied by the user.

### 10.3 Blinded hash

The blinded artifact hash should be computed from the exact bytes offered for
download as the blinded CSV.

### 10.4 Transformation identifier

Each generated blinding operation should receive a unique transformation
identifier.

A browser-generated UUID is acceptable for v0.

The same transformation identifier should appear in:

- receipt; and
- private blinding key.

This links the public audit artifact to the corresponding private key without
revealing the mapping.

---

## 11. CSV serialization

The exact bytes of the blinded CSV matter because the blinded hash refers to
them.

Therefore the application should:

1. generate the final blinded CSV string or byte representation once;
2. hash that exact representation; and
3. use that same representation for the downloadable artifact.

The implementation should avoid independently serializing the dataset once for
hashing and again for download.

Line endings, quoting, delimiters, and escaping should therefore be controlled
by one serialization path.

---

## 12. Preview behavior

The interface may display a limited preview of the blinded derivative.

The ordinary blinded preview should show neutral labels rather than original
values for the selected column.

The application may provide a separate explicit "view private key" action for
the local operator if needed for testing, but the default workflow should
visually reinforce separation between:

- blinded materials; and
- the private mapping.

The UI should not casually display original and blinded category labels
side-by-side after generation.

---

## 13. Error handling

Errors should be explicit and actionable.

At minimum v0 should handle:

### File errors

- no file selected;
- unsupported file extension;
- empty file;
- unreadable file;
- parser failure;
- missing header row; and
- zero data rows.

### Blinding-selection errors

- no column selected;
- selected column not found;
- selected column has fewer than two distinct nonmissing categories; and
- selected column cannot be transformed consistently.

### Generation errors

- failure to generate secure randomness;
- failure to compute hashes;
- serialization failure; and
- artifact-generation failure.

The application should not silently fall back from cryptographically strong
randomness to `Math.random()`.

---

## 14. UI requirements

The initial UI should be functional rather than visually elaborate.

A useful v0 layout may contain the following stages:

### Stage 1: Select data

- CSV file picker;
- local-processing notice;
- source row/column summary after successful parsing.

### Stage 2: Select variable

- list or selector containing available columns;
- selected-column summary;
- distinct nonmissing category count;
- warning if the column is not eligible.

### Stage 3: Generate blinded data

- action to create the mapping and blinded derivative;
- confirmation that the transformation succeeded;
- transformation identifier;
- source and blinded hashes.

### Stage 4: Download artifacts

Separate download actions for:

- blinded CSV;
- blinding receipt;
- private blinding key.

The private-key download should be visually distinguished and accompanied by a
warning that it must remain separate from blinded-analysis materials.

### v0 warning

The workspace should visibly state that:

- v0 is an early single-user prototype;
- processing occurs locally in the browser;
- role-based separation is not yet implemented; and
- the application should not yet be relied upon for sensitive or regulated
  research workflows.

---

## 15. Proposed code organization

The statistical/integrity logic should not live directly inside the main React
page.

A conceptual structure is:

```text
src/
├── app/
│   └── ...
│
├── components/
│   └── blinding/
│       ├── FileUpload.tsx
│       ├── VariableSelector.tsx
│       ├── BlindingPreview.tsx
│       └── ArtifactDownloads.tsx
│
└── lib/
    └── blinding/
        ├── types.ts
        ├── labels.ts
        ├── mapping.ts
        ├── transform.ts
        ├── hashing.ts
        ├── receipt.ts
        └── csv.ts
```

This is a proposed organization, not a requirement to create every file before
it is needed.

The important architectural separation is:

```text
React UI
   |
   v
pure TypeScript blinding/integrity functions
   |
   v
generated artifacts
```

Where practical, blinding functions should be pure and testable independently
of React.

---

## 16. Proposed core types

Exact names may change during implementation, but the logic will likely need
concepts similar to:

```ts
type BlindingMappingEntry = {
  original: string;
  blinded: string;
};

type BlindingPlan = {
  transformationId: string;
  selectedColumn: string;
  mapping: BlindingMappingEntry[];
};

type ArtifactHash = {
  sha256: string;
};

type BlindingReceipt = {
  schemaVersion: string;
  transformationId: string;
  createdAt: string;
  transformationType: "categorical_label_permutation";
  selectedColumn: string;
  categoryCount: number;
  rowCount: number;
  columnCount: number;
  sourceArtifact: ArtifactHash;
  blindedArtifact: ArtifactHash;
};

type BlindingKey = {
  schemaVersion: string;
  transformationId: string;
  createdAt: string;
  transformationType: "categorical_label_permutation";
  selectedColumn: string;
  sourceArtifactSha256: string;
  blindedArtifactSha256: string;
  mapping: BlindingMappingEntry[];
};
```

The implementation should refine these types before treating them as stable
public formats.

---

## 17. Automated testing requirements

This slice introduces enough deterministic application logic that automated
tests are justified.

The test framework should be selected at implementation time based on the
current Next.js/TypeScript environment.

At minimum the blinding engine should test the following.

### Mapping tests

- every distinct nonmissing original category receives one neutral label;
- every neutral label maps to exactly one original category;
- the mapping is bijective;
- repeated original values map consistently;
- the expected number of mapping entries is produced;
- generated neutral labels are unique; and
- missing values do not appear in the mapping.

### Transformation tests

- row count is unchanged;
- column count is unchanged;
- column order is unchanged;
- selected column values are transformed according to the mapping;
- unselected columns remain unchanged;
- missing values remain missing;
- the source object is not mutated; and
- applying the same explicit mapping again reproduces the same transformed
  values.

### Receipt tests

- receipt contains the correct transformation identifier;
- receipt contains source and blinded hashes;
- receipt contains structural metadata;
- receipt contains no mapping;
- receipt contains no original category values; and
- receipt does not contain a secret capable of reconstructing the mapping.

### Key tests

- private key contains the complete mapping;
- private key uses the same transformation identifier as the receipt;
- source hash matches the receipt;
- blinded hash matches the receipt; and
- key is sufficient to reproduce the selected-column transformation.

### Hash tests

- identical bytes produce identical SHA-256 values;
- changed bytes produce a different hash;
- source hash is based on original uploaded bytes; and
- blinded hash is based on the exact downloadable blinded bytes.

### CSV tests

Include fixtures for:

- ordinary comma-separated data;
- quoted values containing commas;
- quoted values containing line breaks if supported by the selected parser;
- empty cells;
- repeated category values;
- more than two categories; and
- nonselected numeric and text columns.

---

## 18. Manual acceptance criteria

Blinding Workspace v0 is complete when a user can successfully perform the
following workflow in the browser:

1. Open the workspace.
2. Select a valid CSV.
3. See the dataset's row and column counts.
4. Select a categorical column containing at least two nonmissing categories.
5. Generate a randomized neutral-label mapping.
6. Generate a blinded derivative.
7. Verify that unrelated columns and dataset dimensions are unchanged.
8. Download the blinded CSV.
9. Download a receipt containing the source/blinded hashes and transformation
   metadata but not the mapping.
10. Download a private key containing the complete mapping.
11. Confirm that receipt and key share the same transformation identifier.
12. Confirm that the blinded CSV hash in the receipt matches the bytes actually
    downloaded.
13. Complete all of the above without the dataset or key being transmitted to a
    blindstats server.

The automated test suite must also pass.

The production application build and lint checks must remain clean.

---

## 19. Design decisions intentionally deferred

The following questions should not block v0:

- final database schema;
- final audit-event schema;
- authentication provider;
- authorization framework;
- Neon configuration;
- Prisma versus Drizzle;
- object-storage provider;
- server-side encryption/key management;
- multi-party unblinding approval;
- retention policies;
- analysis-artifact locking implementation;
- external preregistration integrations;
- AI-assisted rewriting;
- code execution;
- multi-variable blinding; and
- non-CSV formats.

The purpose of v0 is to produce evidence that informs those later decisions.

---

## 20. Expected path after v0

The anticipated sequence after the local blinding workspace is:

```text
Slice 1
Browser-local blinding engine
CSV -> blinded CSV + receipt + key

        ↓

Slice 2
Persistent studies
PostgreSQL + artifact metadata + study states

        ↓

Slice 3
Authentication + teams + permissions
Separate blinded and unblinded access

        ↓

Slice 4
Private object storage
Controlled research-file access

        ↓

Slice 5
Analysis submission + locking
Finalized artifacts + hashes + audit events

        ↓

Slice 6
Authorized unblinding
Mapping release + complete audit history
```

This roadmap may change as implementation reveals new requirements.

The project should continue to prioritize a coherent end-to-end blinding
workflow over adding disconnected features.

---

## 21. Definition of success

Blinding Workspace v0 succeeds if it proves that the scientific heart of
blindstats can be expressed as a small, testable, auditable software workflow.

The important result is not a polished interface.

The important result is a trustworthy transformation pipeline with clearly
separated:

- source artifact;
- blinded artifact;
- public receipt; and
- private blinding key.

That foundation should then be strong enough to place inside the multi-user
permission and study-management architecture required by later versions of
blindstats.
