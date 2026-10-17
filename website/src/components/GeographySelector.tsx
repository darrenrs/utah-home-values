import { useMemo, useRef, type KeyboardEvent } from "react";
import {
  Button,
  ComboBox,
  Header,
  Input,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  useFilter,
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
  ariaLabel = "Select geography",
}: {
  geoType: GeographyType;
  options: GeographyOption[];
  selectedId: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
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
  const listBoxRef = useRef<HTMLDivElement>(null);
  const { contains } = useFilter({ sensitivity: "base" });

  // React Aria only selects on Enter when an option has keyboard focus. If the
  // user typed a search and pressed Enter without arrowing down, pick the first
  // match, the same option shown at the top of the list. This runs in the
  // capture phase, before React Aria handles Enter and clears the focus marker.
  const handleKeyDownCapture = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    if (listBoxRef.current?.querySelector("[data-focused]")) {
      return;
    }

    const query = event.currentTarget.value.trim();
    const match = query
      ? groupedOptions
          .flatMap((group) => group.options)
          .find((option) => contains(option.label, query))
      : undefined;

    if (match) {
      onChange(match.id);
    }
  };

  return (
    <ComboBox
      className="geography-selector"
      aria-label={ariaLabel}
      allowsEmptyCollection
      selectedKey={selectedId}
      onSelectionChange={(key) => {
        if (key !== null) {
          onChange(String(key));
        }
      }}
    >
      <div className="geography-selector-control">
        <Input
          className="geography-selector-input"
          placeholder="Search..."
          onKeyDownCapture={handleKeyDownCapture}
        />
        <Button
          className="geography-selector-button"
          aria-label="Show geographies"
        >
          <span className="geography-selector-arrow" aria-hidden="true" />
        </Button>
      </div>
      <Popover className="geography-selector-popover">
        <ListBox
          ref={listBoxRef}
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
