import requests

# Do not change directory structure
SHAPEFILES = [
    {
        "url": "https://www2.census.gov/geo/tiger/TIGER2024/PLACE/tl_2024_49_place.zip",
        "path": "../data/raw/shapefiles/tl_2024_49_place.zip",
    },
    {
        "url": "https://www2.census.gov/geo/tiger/TIGER2024/ZCTA520/tl_2024_us_zcta520.zip",
        "path": "../data/raw/shapefiles/tl_2024_us_zcta520.zip",
    },
]

for i in SHAPEFILES:
    response = requests.get(i["url"])

    if response.status_code == 200:
        with open(i["path"], "wb") as file:
            file.write(response.content)

        print(f"Successfully downloaded {i['url']}")
    else:
        print(f"Failed to download {i['url']}; please try again")
