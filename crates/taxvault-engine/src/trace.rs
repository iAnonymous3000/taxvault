use rust_decimal::Decimal;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TraceNodeId(pub u32);

#[derive(Clone, Debug)]
pub struct TraceNode {
    pub id: TraceNodeId,
    pub label: String,
    pub value: Decimal,
    pub rule_applied: String,
    pub input_ids: Vec<TraceNodeId>,
}

pub struct CalculationTrace {
    nodes: Vec<TraceNode>,
    root_id: TraceNodeId,
}

impl CalculationTrace {
    pub fn new(nodes: Vec<TraceNode>, root_id: TraceNodeId) -> Self {
        Self { nodes, root_id }
    }

    pub fn root_id(&self) -> TraceNodeId {
        self.root_id
    }

    pub fn get(&self, id: TraceNodeId) -> Option<&TraceNode> {
        self.nodes.iter().find(|n| n.id == id)
    }

    pub fn inputs_of(&self, id: TraceNodeId) -> Vec<&TraceNode> {
        match self.get(id) {
            Some(node) => node
                .input_ids
                .iter()
                .filter_map(|iid| self.get(*iid))
                .collect(),
            None => vec![],
        }
    }

    pub fn display_tree(&self) -> String {
        let mut out = String::new();
        if let Some(root) = self.get(self.root_id) {
            self.fmt_node(&mut out, root, 0);
        }
        out
    }

    fn fmt_node(&self, out: &mut String, node: &TraceNode, depth: usize) {
        let indent = "  ".repeat(depth);
        out.push_str(&format!(
            "{}{}: {} [{}]\n",
            indent, node.label, node.value, node.rule_applied
        ));
        for input_id in &node.input_ids {
            if let Some(child) = self.get(*input_id) {
                self.fmt_node(out, child, depth + 1);
            }
        }
    }
}

impl fmt::Debug for CalculationTrace {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CalculationTrace({} nodes)", self.nodes.len())
    }
}

pub struct TraceBuilder {
    nodes: Vec<TraceNode>,
    next_id: u32,
}

impl TraceBuilder {
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            next_id: 0,
        }
    }

    pub fn add(
        &mut self,
        label: impl Into<String>,
        value: Decimal,
        rule_applied: impl Into<String>,
        input_ids: Vec<TraceNodeId>,
    ) -> TraceNodeId {
        let id = TraceNodeId(self.next_id);
        self.next_id += 1;
        self.nodes.push(TraceNode {
            id,
            label: label.into(),
            value,
            rule_applied: rule_applied.into(),
            input_ids,
        });
        id
    }

    pub fn build(self, root_id: TraceNodeId) -> CalculationTrace {
        CalculationTrace::new(self.nodes, root_id)
    }
}

impl Default for TraceBuilder {
    fn default() -> Self {
        Self::new()
    }
}
