import { useMemo } from "react";
import {
  Button,
  ComboBox,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
} from "react-aria-components";
import type { GeographyMetadata } from "../data/loadData";

export type GeographyType = "wasatchFront" | "county" | "place" | "zcta5";

export type GeographyOption = GeographyMetadata & {
  id: string;
  label: string;
  parentCountyName: string | null;
};

function GeographySelector({
  geoType,
  options,
  selectedId,
  onChange,
}: {
  geoType: GeographyType;
  options: GeographyOption[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  const groupedOptions = useMemo(() => {
    if (geoType !== "place" && geoType !== "zcta5") {
      return [{ label: null, options }];
    }

    const groups = new Map<string, GeographyOption[]>();

    for (const option of options) {
      const groupName = option.parentCountyName ?? "Ungrouped";
      const rows = groups.get(groupName) ?? [];
      rows.push(option);
      groups.set(groupName, rows);
    }

    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, rows]) => ({ label, options: rows }));
  }, [geoType, options]);

  return (
    <ComboBox
      className="geography-selector"
      aria-label="Select geography"
      allowsEmptyCollection
      selectedKey={selectedId}
      onSelectionChange={(key) => {
        if (key !== null) {
          onChange(String(key));
        }
      }}
    >
      <div className="geography-selector-control">
        <Input className="geography-selector-input" placeholder="Search..." />
        <Button
          className="geography-selector-button"
          aria-label="Show geographies"
        >
          <span className="geography-selector-arrow" aria-hidden="true" />
        </Button>
      </div>
      <Popover className="geography-selector-popover">
        <ListBox
          className="geography-selector-listbox"
          renderEmptyState={() => (
            <p className="geography-selector-empty">No matching geographies.</p>
          )}
        >
          {groupedOptions.map((group) =>
            group.label ? (
              <ListBoxSection
                className="geography-selector-section"
                key={group.label}
              >
                <Header className="geography-selector-heading">
                  {group.label}
                </Header>
                {group.options.map((option) => (
                  <ListBoxItem
                    className="geography-selector-option"
                    id={option.id}
                    key={option.id}
                    textValue={option.label}
                  >
                    {option.label}
                  </ListBoxItem>
                ))}
              </ListBoxSection>
            ) : (
              group.options.map((option) => (
                <ListBoxItem
                  className="geography-selector-option"
                  id={option.id}
                  key={option.id}
                  textValue={option.label}
                >
                  {option.label}
                </ListBoxItem>
              ))
            ),
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}

export default GeographySelector;
