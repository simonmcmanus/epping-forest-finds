"""Small text helpers used when turning raw counts into plain-English prose."""


def pluralize_label(label):
    """A simple, testable English pluralizer for category labels like
    "Café" -> "Cafés", "Bakery" -> "Bakeries", "Farm Shop" -> "Farm Shops".
    Only the label's last word is pluralized (the rest is a modifier)."""
    words = label.split(" ")
    last = words[-1]
    lower = last.lower()
    if lower.endswith("y") and len(last) > 1 and last[-2].lower() not in "aeiou":
        plural = last[:-1] + "ies"
    elif lower.endswith(("s", "sh", "ch", "x", "z")):
        plural = last + "es"
    else:
        plural = last + "s"
    return " ".join(words[:-1] + [plural])


def oxford_comma_join(items):
    items = [str(i) for i in items if i]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"
