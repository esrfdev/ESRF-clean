"""Lab-only controlled promotion package.

Converts approved rows from the LAB_* tabs of the Drive intake spreadsheet
(id 1jGDFjTq5atrFSe3avjj4AflUo1SLPKAmkT_MIpH6z1g) into local artefacts:

  * editorial draft markdown under editorials/drafts/lab/
  * directory/atlas candidate JSON under data/candidates/

It NEVER writes Directory_Master and NEVER auto-publishes. Output is meant
to feed an existing GitHub branch/preview review pipeline. See
docs/lab-promotion.md for the full workflow.
"""
