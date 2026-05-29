"""Test that the Jupyter notebook is valid and cells are well-formed.

Does NOT execute cells (would require live services) — just validates structure.
"""

import json
import os
import pytest


NOTEBOOK_PATH = os.path.join(os.path.dirname(__file__), "../../notebook/demo.ipynb")


@pytest.fixture
def notebook():
    with open(NOTEBOOK_PATH) as f:
        return json.load(f)


class TestNotebookStructure:
    """Validate notebook format and content."""

    def test_notebook_is_valid_ipynb(self, notebook):
        """Notebook is valid nbformat."""
        assert notebook["nbformat"] == 4
        assert "cells" in notebook

    def test_has_markdown_and_code_cells(self, notebook):
        """Notebook contains both markdown and code cells."""
        cell_types = {c["cell_type"] for c in notebook["cells"]}
        assert "markdown" in cell_types
        assert "code" in cell_types

    def test_has_setup_cell(self, notebook):
        """First code cell imports from core/."""
        code_cells = [c for c in notebook["cells"] if c["cell_type"] == "code"]
        first_code = "".join(code_cells[0]["source"])
        assert "from core" in first_code

    def test_has_multiple_steps(self, notebook):
        """Notebook has at least 5 step sections."""
        markdown_cells = [c for c in notebook["cells"] if c["cell_type"] == "markdown"]
        step_cells = [c for c in markdown_cells if any("Step" in line or "##" in line for line in c["source"])]
        assert len(step_cells) >= 5

    def test_code_cells_are_non_empty(self, notebook):
        """All code cells have content."""
        code_cells = [c for c in notebook["cells"] if c["cell_type"] == "code"]
        for i, cell in enumerate(code_cells):
            source = "".join(cell["source"]).strip()
            assert len(source) > 0, f"Code cell {i} is empty"

    def test_no_hardcoded_credentials(self, notebook):
        """No real credentials in the notebook."""
        full_text = json.dumps(notebook)
        # Ensure no AWS account IDs (12-digit numbers that look like accounts)
        import re
        account_ids = re.findall(r'\b\d{12}\b', full_text)
        assert len(account_ids) == 0, f"Found potential AWS account ID(s): {account_ids}"
        # No personal aliases (add your own alias here when running locally)
        assert "@amazon" not in full_text.lower()
        assert "cdp_api_key" not in full_text.lower()
