import json
import html
import math
import re
import statistics
import sys
import urllib.request
import urllib.parse

import xlrd

INDEX_URL = "https://shillerdata.com/"
FALLBACK_URL = "http://www.econ.yale.edu/~shiller/data/ie_data.xls"

index_request = urllib.request.Request(INDEX_URL, headers={"User-Agent": "ACFC-Market-Watch/1.0"})
with urllib.request.urlopen(index_request, timeout=30) as response:
    index_html = response.read().decode("utf-8", errors="replace")
match = re.search(r'href=["\']([^"\']+/ie_data\.xls[^"\']*)["\']', index_html, re.IGNORECASE)
SOURCE_URL = urllib.parse.urljoin(INDEX_URL, html.unescape(match.group(1))) if match else FALLBACK_URL

request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "ACFC-Market-Watch/1.0"})
with urllib.request.urlopen(request, timeout=30) as response:
    workbook_bytes = response.read()

book = xlrd.open_workbook(file_contents=workbook_bytes)
sheet = book.sheet_by_name("Data")

header_row = None
cape_column = None
for row_index in range(min(sheet.nrows, 20)):
    if str(sheet.cell_value(row_index, 0)).strip().upper() != "DATE":
        continue
    for column_index in range(sheet.ncols):
        if str(sheet.cell_value(row_index, column_index)).strip().upper() == "CAPE":
            header_row = row_index
            cape_column = column_index
            break

if header_row is None or cape_column is None:
    raise RuntimeError("CAPE column was not found in the Shiller workbook")

observations = []
for row_index in range(header_row + 1, sheet.nrows):
    raw_date = sheet.cell_value(row_index, 0)
    raw_cape = sheet.cell_value(row_index, cape_column)
    if not isinstance(raw_date, (int, float)) or not isinstance(raw_cape, (int, float)):
        continue
    if not math.isfinite(raw_cape) or raw_cape <= 0:
        continue
    year = int(raw_date)
    month = int(round((raw_date - year) * 100))
    if month < 1 or month > 12:
        continue
    observations.append({"period": f"{year:04d}-{month:02d}", "value": round(raw_cape, 2)})

if not observations:
    raise RuntimeError("No CAPE observations were parsed from the Shiller workbook")

values = [point["value"] for point in observations]
current = observations[-1]
percentile = sum(value <= current["value"] for value in values) / len(values) * 100
output = {
    "available": True,
    "stale": False,
    "source": "Robert J. Shiller data workbook",
    "sourceUrl": INDEX_URL,
    "workbookUrl": SOURCE_URL,
    "period": current["period"],
    "value": current["value"],
    "longTermAverage": round(statistics.mean(values), 2),
    "longTermMedian": round(statistics.median(values), 2),
    "historicalPercentile": round(percentile, 1),
    "history": observations[-240:],
}
json.dump(output, sys.stdout, ensure_ascii=False)
