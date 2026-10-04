#Spatial Intelligence for Urban Greening: Identifying Priority Locations and Greening Interventions

BPS5231 (AI for Sustainable Building Design) group project.
Study site: NUS Kent Ridge Campus.

Workflow: weather-station data (EDA) -> GIS spatial features -> ML analysis -> greenability / priority greening map.

## Structure
- `data/raw/` original datasets (not tracked), `data/processed/` cleaned data
- `notebooks/` EDA and analysis, `src/` reusable code
- `outputs/` figures and tables, `docs/` documentation

## Data
Hourly 2025 data from 40 NUS campus weather stations (City Syntax Lab, Zenodo DOI 10.5281/zenodo.20477761).
Raw CSVs in `data/raw/` are not tracked by git. To reproduce:

```bash
pip install -r requirements.txt
python -c "import nus_campus_weather as ncw; print(ncw.fetch_dataset())"
```
then copy the `data/raw/*.csv` files from the printed path into this repo's `data/raw/`.
